export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
    parseMessage,
    parseCustomerMessage,
    addTask,
    completeTask,
    getEmployeeTasks,
    sendMessageToGroup,
    cancelLastRecord,
    deleteTask,
    updateTask,
    setReminder,
    scheduleMeeting
} from '@/lib/ai-parser';

const LINE_API_URL = 'https://api.line.me/v2/bot/message/reply';

async function replyMessage(replyToken: string, text: string) {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    await fetch(LINE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            replyToken,
            messages: [{ type: 'text', text }]
        }),
    });
}

async function pushMessage(groupId: string, text: string) {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            to: groupId,
            messages: [{ type: 'text', text }]
        }),
    });
}

async function getGroupName(groupId: string): Promise<string> {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    try {
        const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (res.ok) {
            const data = await res.json();
            return data.groupName || '未命名群組';
        }
    } catch (error) {
        console.error('取得群組名稱失敗:', error);
    }

    return '未命名群組';
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        console.log('LINE Webhook received:', JSON.stringify(body, null, 2));

        for (const event of body.events || []) {
            const sourceType = event.source?.type;
            const groupId = event.source?.groupId;
            const userId = event.source?.userId;
            const replyToken = event.replyToken;

            // 機器人加入群組
            if (event.type === 'join') {
                if (groupId) {
                    const groupName = await getGroupName(groupId);

                    const { data: existing } = await supabase
                        .from('agent_groups')
                        .select('id')
                        .eq('line_group_id', groupId)
                        .single();

                    if (!existing) {
                        await supabase.from('agent_groups').insert({
                            group_name: groupName,
                            line_group_id: groupId,
                            group_type: 'customer',
                            is_active: true
                        });
                    }

                    const { data: existingAcct } = await supabase
                        .from('acct_line_groups')
                        .select('id')
                        .eq('group_id', groupId)
                        .single();

                    if (!existingAcct) {
                        const { data: company } = await supabase
                            .from('acct_companies')
                            .select('id')
                            .limit(1)
                            .single();

                        if (company) {
                            await supabase.from('acct_line_groups').insert({
                                company_id: company.id,
                                group_id: groupId,
                                group_name: groupName,
                                group_type: 'group',
                                is_active: true,
                                description: `自動偵測於 ${new Date().toLocaleString('zh-TW')}`
                            });
                        }
                    }

                    if (replyToken) {
                        await replyMessage(replyToken, `✅ 智慧媽咪 AI 助理已加入「${groupName}」！`);
                    }
                }
                continue;
            }

            // 文字訊息處理
            if (event.type === 'message' && event.message?.type === 'text') {
                const text = event.message.text.trim();
                const textLower = text.toLowerCase();

                // 查詢 Group ID
                if (textLower === '!groupid' || textLower === '/groupid' || textLower === 'groupid') {
                    if (replyToken) {
                        let reply = '';
                        if (sourceType === 'group' && groupId) {
                            reply = `📋 群組 ID:\n${groupId}`;
                        } else if (sourceType === 'user' && userId) {
                            reply = `📋 用戶 ID:\n${userId}`;
                        } else {
                            reply = '無法取得 ID';
                        }
                        await replyMessage(replyToken, reply);
                    }
                    continue;
                }

                // 取得群組資訊
                let groupType = 'unknown';
                let groupName = '';
                if (groupId) {
                    const { data: group } = await supabase
                        .from('agent_groups')
                        .select('group_type, group_name')
                        .eq('line_group_id', groupId)
                        .single();
                    groupType = group?.group_type || 'unknown';
                    groupName = group?.group_name || '';
                }

                // 客戶、合作夥伴、會計群組
                if (['customer', 'partner', 'accounting'].includes(groupType)) {
                    // 記錄訊息（包括老闆的）
                    await supabase.from('agent_customer_messages').insert({
                        group_id: groupId,
                        group_name: groupName,
                        group_type: groupType,
                        user_id: userId,
                        message: text,
                        is_replied: false
                    });

                    // 老闆自己的訊息不通知
                    if (userId === 'U9f60f88dca07d665c4ab000bc2d3f5f3') {
                        console.log('老闆訊息，已記錄但不通知');
                        continue;
                    }

                    const parsed = await parseCustomerMessage(text);

                    if (parsed.type === 'urgent' || parsed.type === 'question' || parsed.type === 'payment') {
                        const { data: managerGroup } = await supabase
                            .from('agent_groups')
                            .select('line_group_id')
                            .eq('group_type', 'manager')
                            .single();

                        if (managerGroup) {
                            let typeLabel = '📩';
                            if (parsed.type === 'urgent') typeLabel = '🚨 緊急';
                            if (parsed.type === 'question') typeLabel = '❓ 問題';
                            if (parsed.type === 'payment') typeLabel = '💰 付款';

                            const notifyText = `${typeLabel}【${groupName}】：\n\n${text}`;
                            await pushMessage(managerGroup.line_group_id, notifyText);
                        }
                    }
                    continue;
                }

                // 公司群組不處理
                if (groupType === 'company') {
                    continue;
                }

                // 員工群組
                if (groupType === 'employee') {
                    // 記錄員工訊息（不通知）
                    await supabase.from('agent_customer_messages').insert({
                        group_id: groupId,
                        group_name: groupName,
                        group_type: groupType,
                        user_id: userId,
                        message: text,
                        is_replied: false
                    });

                    const parsed = await parseMessage(text, groupType);

                    if (parsed.intent === 'complete_task') {
                        const { data: group } = await supabase
                            .from('agent_groups')
                            .select('employee_id')
                            .eq('line_group_id', groupId)
                            .single();

                        if (group?.employee_id) {
                            const result = await completeTask(group.employee_id, text);
                            if (replyToken) {
                                await replyMessage(replyToken, result.message);
                            }
                        }
                    }
                    continue;
                }

                // 主管群組
                if (groupType === 'manager') {
                    const parsed = await parseMessage(text, groupType);
                    console.log('AI 解析結果:', parsed);

                    // 發送訊息
                    if (parsed.intent === 'send_message' && parsed.target_group && parsed.message_content) {
                        const result = await sendMessageToGroup(parsed.target_group, parsed.message_content);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    // 取消回報
                    if (parsed.intent === 'cancel_record' && parsed.employee_name) {
                        const result = await cancelLastRecord(parsed.employee_name);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    // 刪除任務
                    if (parsed.intent === 'delete_task' && parsed.employee_name && parsed.task_name) {
                        const result = await deleteTask(parsed.employee_name, parsed.task_name);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    // 修改任務
                    if (parsed.intent === 'update_task' && parsed.employee_name && parsed.task_name && parsed.frequency_detail) {
                        const result = await updateTask(parsed.employee_name, parsed.task_name, parsed.frequency_detail);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    // 設定提醒
                    if (parsed.intent === 'set_reminder' && parsed.reminder_time && parsed.reminder_content) {
                        const result = await setReminder(parsed.reminder_time, parsed.reminder_content, groupId);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    // 設定線上會議
                    if (parsed.intent === 'schedule_meeting' && parsed.target_group && parsed.meeting_date && parsed.reminder_time) {
                        const result = await scheduleMeeting(parsed.target_group, parsed.meeting_date, parsed.reminder_time);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    // 新增任務
                    if (parsed.intent === 'add_task' && parsed.employee_name) {
                        const result = await addTask(
                            parsed.employee_name,
                            parsed.task_name || '未命名任務',
                            parsed.client_name || '',
                            parsed.frequency || 'weekly',
                            parsed.frequency_detail || ''
                        );
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    // 查詢任務
                    if (parsed.intent === 'query_tasks' && parsed.employee_name) {
                        const { data: employee } = await supabase
                            .from('agent_employees')
                            .select('id')
                            .eq('name', parsed.employee_name)
                            .single();

                        if (employee) {
                            const tasks = await getEmployeeTasks(employee.id);
                            if (replyToken) {
                                await replyMessage(replyToken, tasks);
                            }
                        }
                        continue;
                    }
                    continue;
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return NextResponse.json({ error: 'Webhook 處理失敗' }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: 'AI Agent Webhook is ready' });
}
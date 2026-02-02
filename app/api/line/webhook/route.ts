export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
    parseMessage,
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
const BOSS_USER_ID = 'U9f60f88dca07d665c4ab000bc2d3f5f3';

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

                    // 老闆的訊息：標記已回覆
                    if (userId === BOSS_USER_ID) {
                        await supabase.from('agent_customer_messages').insert({
                            group_id: groupId,
                            group_name: groupName,
                            group_type: groupType,
                            user_id: userId,
                            message: '(已回覆)',
                            is_replied: true
                        });
                        continue;
                    }

                    // 記錄訊息（前50字）
                    await supabase.from('agent_customer_messages').insert({
                        group_id: groupId,
                        group_name: groupName,
                        group_type: groupType,
                        user_id: userId,
                        message: text.length > 50 ? text.substring(0, 50) + '...' : text,
                        is_replied: false
                    });

                    // 老闆 2 小時內有回覆過 → 不通知（正在對話中）
                    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
                    const { data: recentBossReply } = await supabase
                        .from('agent_customer_messages')
                        .select('id')
                        .eq('group_id', groupId)
                        .eq('user_id', BOSS_USER_ID)
                        .gte('created_at', twoHoursAgo)
                        .limit(1);

                    if (recentBossReply && recentBossReply.length > 0) {
                        continue;
                    }

                    // 30 分鐘內是否已通知過
                    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
                    const { data: recentMessages } = await supabase
                        .from('agent_customer_messages')
                        .select('id')
                        .eq('group_id', groupId)
                        .neq('user_id', BOSS_USER_ID)
                        .gte('created_at', thirtyMinutesAgo)
                        .limit(2);

                    // 30 分鐘內第一則訊息才通知
                    if (!recentMessages || recentMessages.length <= 1) {
                        const { data: managerGroup } = await supabase
                            .from('agent_groups')
                            .select('line_group_id')
                            .eq('group_type', 'manager')
                            .eq('is_active', true)
                            .single();

                        if (managerGroup) {
                            const notifyText = `📩 ${groupName} 有新訊息`;
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
                    // 老闆的訊息不處理
                    if (userId === BOSS_USER_ID) {
                        continue;
                    }

                    // 查詢今日任務（精確匹配）
                    if (text.includes('今日排程') || text.includes('今天排程') || text.includes('今日任務') || text.includes('今天任務')) {
                        const { data: group } = await supabase
                            .from('agent_groups')
                            .select('employee_id')
                            .eq('line_group_id', groupId)
                            .single();

                        if (group?.employee_id) {
                            const tasks = await getEmployeeTasks(group.employee_id);
                            if (replyToken) {
                                await replyMessage(replyToken, tasks);
                            }
                        }
                        continue;
                    }

                    // 回報完成任務
                    const completeTriggers = ['完成', '做好', '做完', '好了', 'OK', 'ok', '搞定'];
                    const isComplete = completeTriggers.some(w => text.includes(w));
                    if (isComplete) {
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
                        continue;
                    }

                    // 其他訊息不處理
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
                        const { data: emp } = await supabase
                            .from('agent_employees')
                            .select('id')
                            .eq('name', parsed.employee_name)
                            .single();

                        if (emp) {
                            const tasks = await getEmployeeTasks(emp.id);
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

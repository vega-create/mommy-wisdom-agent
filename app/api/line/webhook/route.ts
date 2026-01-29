export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseMessage, addTask, completeTask, getEmployeeTasks } from '@/lib/ai-parser';

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

            // 機器人加入群組 → 記錄 group ID
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
                        console.log('新群組已記錄:', groupName, groupId);
                    }

                    // 同時寫入會計系統的表
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

                // 查詢 Group ID 指令（所有群組都可用）
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

                // 收集客戶、合作夥伴、會計群組的訊息（不自動回覆）
                if (['customer', 'partner', 'accounting'].includes(groupType)) {
                    await supabase.from('agent_customer_messages').insert({
                        group_id: groupId,
                        group_name: groupName,
                        group_type: groupType,
                        user_id: userId,
                        message: text,
                        is_replied: false
                    });
                    console.log('已記錄訊息:', groupName, text);
                    continue;
                }

                // 公司群組不處理
                if (groupType === 'company') {
                    console.log('公司群組，不處理:', text);
                    continue;
                }

                // 員工群組只處理「完成任務」
                if (groupType === 'employee') {
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
                    // 其他訊息不回應
                    continue;
                }

                // 主管群組處理所有指令
                if (groupType === 'manager') {
                    const parsed = await parseMessage(text, groupType);
                    console.log('AI 解析結果:', parsed);

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
                    // 主管群其他訊息不回應
                    continue;
                }

                // 其他訊息不處理
                console.log('未處理訊息:', text);
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
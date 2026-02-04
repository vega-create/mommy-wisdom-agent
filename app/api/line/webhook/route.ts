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

interface TodoItem {
    index: number;
    text: string;
    done: boolean;
}

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

                // ========================================
                // ⭐ 私訊處理（員工綁定）
                // ========================================
                if (sourceType === 'user' && userId) {

                    // 查詢 User ID
                    if (textLower === '!groupid' || textLower === '/groupid' || textLower === 'groupid') {
                        if (replyToken) {
                            await replyMessage(replyToken, `📋 用戶 ID:\n${userId}`);
                        }
                        continue;
                    }

                    // 綁定流程
                    if (text === '綁定' || text.startsWith('綁定 ') || text.startsWith('綁定')) {
                        const inputName = text.replace('綁定', '').trim();

                        // 先查這個 userId 是否已經綁定
                        const { data: alreadyBound } = await supabase
                            .from('agent_employees')
                            .select('id, name')
                            .eq('line_user_id', userId)
                            .single();

                        if (alreadyBound) {
                            if (replyToken) {
                                await replyMessage(replyToken, `✅ 你已經綁定為「${alreadyBound.name}」囉！`);
                            }
                            continue;
                        }

                        // 情況 A：只輸入「綁定」→ 自動比對 LINE 顯示名稱
                        if (!inputName) {
                            let displayName = '';
                            try {
                                const profileRes = await fetch(
                                    `https://api.line.me/v2/bot/profile/${userId}`,
                                    { headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
                                );
                                if (profileRes.ok) {
                                    const profile = await profileRes.json();
                                    displayName = profile.displayName || '';
                                }
                            } catch (e) {
                                console.error('取得 LINE 名稱失敗:', e);
                            }

                            // 找還沒綁定的員工
                            const { data: unboundEmployees } = await supabase
                                .from('agent_employees')
                                .select('id, name, line_user_id')
                                .is('line_user_id', null)
                                .eq('is_active', true);

                            if (unboundEmployees && unboundEmployees.length > 0) {
                                // 嘗試用 LINE 顯示名稱匹配
                                const matched = unboundEmployees.find((e: { id: string; name: string; line_user_id: string | null }) =>
                                    displayName.includes(e.name) || e.name.includes(displayName)
                                );

                                if (matched) {
                                    await supabase
                                        .from('agent_employees')
                                        .update({ line_user_id: userId })
                                        .eq('id', matched.id);

                                    if (replyToken) {
                                        await replyMessage(replyToken,
                                            `✅ 綁定成功！\n你好 ${matched.name} 👋\n\n之後你在客戶群的訊息就不會被當成客戶訊息囉！`
                                        );
                                    }
                                    continue;
                                }
                            }

                            // 自動匹配失敗 → 提示手動輸入
                            const unboundList = unboundEmployees
                                ?.map((e: { id: string; name: string; line_user_id: string | null }, i: number) => `${i + 1}. ${e.name}`)
                                .join('\n') || '（無未綁定員工）';

                            if (replyToken) {
                                await replyMessage(replyToken,
                                    `🔍 找不到匹配的員工\n你的 LINE 名稱：${displayName}\n\n請輸入「綁定 你的名字」\n例如：綁定 雅涵\n\n目前未綁定的員工：\n${unboundList}`
                                );
                            }
                            continue;
                        }

                        // 情況 B：輸入「綁定 雅涵」→ 用名字精確比對
                        const { data: employee } = await supabase
                            .from('agent_employees')
                            .select('id, name, line_user_id')
                            .eq('name', inputName)
                            .eq('is_active', true)
                            .single();

                        if (!employee) {
                            if (replyToken) {
                                await replyMessage(replyToken, `❌ 找不到員工「${inputName}」\n請確認名字跟系統裡的一樣`);
                            }
                            continue;
                        }

                        if (employee.line_user_id && employee.line_user_id !== userId) {
                            if (replyToken) {
                                await replyMessage(replyToken, `⚠️ 「${inputName}」已被其他帳號綁定，請聯繫主管`);
                            }
                            continue;
                        }

                        await supabase
                            .from('agent_employees')
                            .update({ line_user_id: userId })
                            .eq('id', employee.id);

                        if (replyToken) {
                            await replyMessage(replyToken,
                                `✅ 綁定成功！\n你好 ${employee.name} 👋\n\n之後你在客戶群的訊息就不會被當成客戶訊息囉！`
                            );
                        }
                        continue;
                    }

                    // 其他私訊不處理（未來可擴充）
                    continue;
                }

                // ========================================
                // 以下是群組訊息處理
                // ========================================

                // 查詢 Group ID
                if (textLower === '!groupid' || textLower === '/groupid' || textLower === 'groupid') {
                    if (replyToken) {
                        let reply = '';
                        if (sourceType === 'group' && groupId) {
                            reply = `📋 群組 ID:\n${groupId}`;
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

                    // 老闆的訊息：標記該群組已回覆
                    if (userId === BOSS_USER_ID) {
                        await supabase.from('agent_customer_messages').insert({
                            group_id: groupId,
                            group_name: groupName,
                            group_type: groupType,
                            user_id: userId,
                            message: '(已回覆)',
                            is_replied: true
                        });

                        // 把該群組所有舊的未回覆訊息都標記為已回覆
                        await supabase
                            .from('agent_customer_messages')
                            .update({ is_replied: true })
                            .eq('group_id', groupId)
                            .eq('is_replied', false);

                        continue;
                    }

                    // ⭐ 排除員工訊息（綁定後生效）
                    if (userId) {
                        const { data: isEmployee } = await supabase
                            .from('agent_employees')
                            .select('id')
                            .eq('line_user_id', userId)
                            .eq('is_active', true)
                            .single();

                        if (isEmployee) {
                            console.log(`員工在客戶群 ${groupName} 發言，跳過`);
                            continue;
                        }
                    }

                    // 過濾機器人訊息（沒有 userId 的是機器人）
                    if (!userId) {
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

                    // ⭐ 偵測 #今日待辦（只認第一行是 #今日待辦）
                    const firstLine = text.trim().split('\n')[0].trim();
                    const isTodoList = firstLine === '#今日待辦';

                    if (isTodoList) {
                        const lines: string[] = text.split('\n').slice(1).filter((l: string) => /^\d+[\.\、\)]/.test(l.trim()));
                        const items: TodoItem[] = lines.map((line: string, i: number) => {
                            const cleanLine = line.replace(/^\d+[\.\、\)]\s*/, '').trim();
                            const isDone = /[V✓✅☑️v]/.test(cleanLine);
                            const itemText = cleanLine.replace(/\s*[V✓✅☑️v]\s*$/, '').trim();
                            return { index: i + 1, text: itemText, done: isDone };
                        });

                        if (items.length > 0) {
                            const totalCount = items.length;
                            const doneCount = items.filter((i: TodoItem) => i.done).length;
                            const todayDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

                            const { data: group } = await supabase
                                .from('agent_groups')
                                .select('employee_id')
                                .eq('line_group_id', groupId)
                                .single();

                            const { data: employee } = await supabase
                                .from('agent_employees')
                                .select('name')
                                .eq('id', group?.employee_id)
                                .single();

                            const { data: existing } = await supabase
                                .from('agent_daily_todos')
                                .select('id')
                                .eq('employee_id', group?.employee_id)
                                .eq('todo_date', todayDate)
                                .single();

                            if (existing) {
                                await supabase
                                    .from('agent_daily_todos')
                                    .update({
                                        items: JSON.stringify(items),
                                        total_count: totalCount,
                                        done_count: doneCount,
                                        raw_text: text,
                                        updated_at: new Date().toISOString()
                                    })
                                    .eq('id', existing.id);
                            } else {
                                await supabase
                                    .from('agent_daily_todos')
                                    .insert({
                                        employee_id: group?.employee_id,
                                        employee_name: employee?.name || '',
                                        group_id: groupId,
                                        todo_date: todayDate,
                                        items: JSON.stringify(items),
                                        total_count: totalCount,
                                        done_count: doneCount,
                                        raw_text: text
                                    });
                            }

                            const percent = Math.round((doneCount / totalCount) * 100);
                            let statusEmoji = '📋';
                            if (percent === 100) statusEmoji = '🎉';
                            else if (percent >= 50) statusEmoji = '💪';

                            let replyText = `${statusEmoji} 已記錄今日 ${totalCount} 項待辦`;
                            if (doneCount > 0) {
                                replyText += `，已完成 ${doneCount} 項 (${percent}%)`;
                            }
                            replyText += '\n\n';

                            items.forEach((item: TodoItem) => {
                                replyText += item.done ? `✅ ${item.text}\n` : `⬜ ${item.text}\n`;
                            });

                            if (doneCount === totalCount && totalCount > 0) {
                                replyText += '\n🎉 全部完成，辛苦了！';
                            } else {
                                replyText += `\n還剩 ${totalCount - doneCount} 項加油💪`;
                            }

                            if (replyToken) {
                                await replyMessage(replyToken, replyText.trim());
                            }
                        }
                        continue;
                    }

                    // ⭐ 查詢今日待辦進度
                    if (text.trim() === '#查進度') {
                        const todayDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

                        const { data: group } = await supabase
                            .from('agent_groups')
                            .select('employee_id')
                            .eq('line_group_id', groupId)
                            .single();

                        const { data: customTodo } = await supabase
                            .from('agent_daily_todos')
                            .select('*')
                            .eq('employee_id', group?.employee_id)
                            .eq('todo_date', todayDate)
                            .single();

                        if (customTodo) {
                            const items = typeof customTodo.items === 'string'
                                ? JSON.parse(customTodo.items)
                                : customTodo.items;
                            const done = items.filter((i: any) => i.done).length;
                            const total = items.length;
                            const percent = Math.round((done / total) * 100);
                            const undone = items.filter((i: any) => !i.done);

                            let progressText = `📊 今日進度：${done}/${total} (${percent}%)\n\n`;

                            if (undone.length > 0) {
                                progressText += `未完成：\n`;
                                undone.forEach((item: any) => {
                                    progressText += `⬜ ${item.text}\n`;
                                });
                            } else {
                                progressText += `🎉 全部完成！`;
                            }

                            if (replyToken) {
                                await replyMessage(replyToken, progressText.trim());
                            }
                        } else {
                            if (replyToken) {
                                await replyMessage(replyToken, '📋 今天還沒有 po 待辦清單喔！\n\n用 #今日待辦 開頭來記錄');
                            }
                        }
                        continue;
                    }

                    // 查詢今日排程任務
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

                    // ⭐ 回報完成任務（優先用自訂待辦）
                    const completeTriggers: string[] = ['完成', '做好了', '做完了', '搞定'];
                    const isComplete = completeTriggers.some((w: string) => text.includes(w));
                    if (isComplete) {
                        const { data: group } = await supabase
                            .from('agent_groups')
                            .select('employee_id')
                            .eq('line_group_id', groupId)
                            .single();

                        if (group?.employee_id) {
                            const todayDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

                            // 先查今天有沒有自訂待辦
                            const { data: customTodo } = await supabase
                                .from('agent_daily_todos')
                                .select('*')
                                .eq('employee_id', group.employee_id)
                                .eq('todo_date', todayDate)
                                .single();

                            if (customTodo) {
                                // 用自訂待辦清單
                                const items = typeof customTodo.items === 'string'
                                    ? JSON.parse(customTodo.items)
                                    : customTodo.items;

                                // 找最匹配的未完成項目
                                let matchedIndex = -1;
                                let bestScore = 0;
                                items.forEach((item: any, idx: number) => {
                                    if (item.done) return;
                                    const keywords: string[] = item.text.replace(/[\[\]]/g, '').split(/[\s\/、，,]+/);
                                    const score = keywords.filter((kw: string) => kw.length > 1 && text.includes(kw)).length;
                                    if (score > bestScore) {
                                        bestScore = score;
                                        matchedIndex = idx;
                                    }
                                });

                                if (matchedIndex >= 0) {
                                    items[matchedIndex].done = true;
                                    const doneCount = items.filter((i: any) => i.done).length;
                                    const totalCount = items.length;
                                    const percent = Math.round((doneCount / totalCount) * 100);

                                    await supabase
                                        .from('agent_daily_todos')
                                        .update({
                                            items: JSON.stringify(items),
                                            done_count: doneCount,
                                            updated_at: new Date().toISOString()
                                        })
                                        .eq('id', customTodo.id);

                                    let emoji = '💪';
                                    if (doneCount === totalCount) emoji = '🎉';

                                    let replyText = `✅ 完成「${items[matchedIndex].text}」\n`;
                                    replyText += `${emoji} 今日進度 ${doneCount}/${totalCount} (${percent}%)`;

                                    if (doneCount === totalCount) {
                                        replyText += '\n\n🎉 全部完成，辛苦了！';
                                    } else {
                                        replyText += `\n\n還剩 ${totalCount - doneCount} 項`;
                                    }

                                    if (replyToken) {
                                        await replyMessage(replyToken, replyText);
                                    }
                                } else {
                                    if (replyToken) {
                                        await replyMessage(replyToken, '找不到對應的待辦項目，可以說清楚一點嗎？');
                                    }
                                }
                            } else {
                                // 沒有自訂待辦，用原本邏輯
                                const result = await completeTask(group.employee_id, text);
                                if (replyToken) {
                                    await replyMessage(replyToken, result.message);
                                }
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

                    if (parsed.intent === 'complete_task' && !parsed.employee_name) {
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

                    if (parsed.intent === 'send_message' && parsed.target_group && parsed.message_content) {
                        const result = await sendMessageToGroup(parsed.target_group, parsed.message_content);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    if (parsed.intent === 'cancel_record' && parsed.employee_name) {
                        const result = await cancelLastRecord(parsed.employee_name);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    if (parsed.intent === 'delete_task' && parsed.employee_name && parsed.task_name) {
                        const result = await deleteTask(parsed.employee_name, parsed.task_name);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    if (parsed.intent === 'update_task' && parsed.employee_name && parsed.task_name && parsed.frequency_detail) {
                        const result = await updateTask(parsed.employee_name, parsed.task_name, parsed.frequency_detail);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    if (parsed.intent === 'set_reminder' && parsed.reminder_time && parsed.reminder_content) {
                        const result = await setReminder(parsed.reminder_time, parsed.reminder_content, groupId);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

                    if (parsed.intent === 'schedule_meeting' && parsed.target_group && parsed.meeting_date && parsed.reminder_time) {
                        const result = await scheduleMeeting(parsed.target_group, parsed.meeting_date, parsed.reminder_time);
                        if (replyToken) {
                            await replyMessage(replyToken, result.message);
                        }
                        continue;
                    }

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

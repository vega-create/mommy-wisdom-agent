export const dynamic = 'force-dynamic';
export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
    try {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
        const dayOfWeek = now.getDay();
        const todayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const todayStr = now.toLocaleDateString('sv-SE');

        // 計算昨天日期
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toLocaleDateString('sv-SE');

        const { data: employees } = await supabase
            .from('agent_employees')
            .select('id, name, line_group_id')
            .eq('is_active', true);

        if (!employees) return NextResponse.json({ success: true });

        for (const emp of employees) {
            if (isWeekend && emp.name !== 'Vega') continue;
            if (!emp.line_group_id) continue;

            // 取得今日排程任務
            const { data: tasks } = await supabase
                .from('agent_tasks')
                .select('id, task_name, client_name, frequency_detail')
                .eq('employee_id', emp.id)
                .eq('is_active', true);

            const todayTasks = (tasks || []).filter(task => {
                const detail = task.frequency_detail || '';
                if (detail === '每天') return true;
                if (detail === '不固定') return false;
                if (detail.includes(todayName)) return true;
                return false;
            });

            // ⭐ 查昨天的 #今日待辦 有沒有未完成項目
            const { data: yesterdayTodo } = await supabase
                .from('agent_daily_todos')
                .select('*')
                .eq('employee_id', emp.id)
                .eq('todo_date', yesterdayStr)
                .single();

            let carryOverItems: string[] = [];
            if (yesterdayTodo) {
                const items = typeof yesterdayTodo.items === 'string'
                    ? JSON.parse(yesterdayTodo.items)
                    : yesterdayTodo.items;
                carryOverItems = items
                    .filter((i: any) => !i.done)
                    .map((i: any) => i.text);
            }

            // 查今天有沒有改期過來的項目
            const { data: rescheduledTodo } = await supabase
                .from('agent_daily_todos')
                .select('*')
                .eq('employee_id', emp.id)
                .eq('todo_date', todayStr)
                .single();

            let rescheduledItems: string[] = [];
            if (rescheduledTodo && rescheduledTodo.raw_text?.includes('改期自')) {
                const rItems = typeof rescheduledTodo.items === 'string'
                    ? JSON.parse(rescheduledTodo.items)
                    : rescheduledTodo.items;
                rescheduledItems = rItems.map((i: any) => i.text);
            }

            // 組合訊息
            let message = `☀️ 早安 ${emp.name}！\n\n`;

            // 昨日未完成
            if (carryOverItems.length > 0) {
                message += `⚠️ 昨日未完成（${carryOverItems.length} 項）：\n`;
                carryOverItems.forEach(item => {
                    message += `🔴 ${item}\n`;
                });
                message += `\n`;
            }

            // 改期項目
            if (rescheduledItems.length > 0) {
                message += `📅 改期待辦（${rescheduledItems.length} 項）：\n`;
                rescheduledItems.forEach(item => {
                    message += `🔵 ${item}\n`;
                });
                message += `\n`;
            }

            // 今日排程任務
            if (todayTasks.length > 0) {
                message += `📋 今日排程任務（${todayTasks.length} 項）：\n`;
                todayTasks.forEach(t => {
                    const client = t.client_name ? `[${t.client_name}] ` : '';
                    message += `⬜ ${client}${t.task_name}\n`;
                });
            }

            // 都沒有就不發
            if (carryOverItems.length === 0 && todayTasks.length === 0 && rescheduledItems.length === 0) continue;

            if (carryOverItems.length > 0) {
                message += `\n記得先補完昨天的再做今天的💪`;
            }

            // ⭐ 自動建立今日待辦（排程任務 + 昨日未完成）
            if (todayTasks.length > 0 || carryOverItems.length > 0) {
                const { data: existingTodo } = await supabase
                    .from('agent_daily_todos')
                    .select('*')
                    .eq('employee_id', emp.id)
                    .eq('todo_date', todayStr)
                    .single();

                if (existingTodo && existingTodo.raw_text?.includes('改期自') && !existingTodo.raw_text?.includes('已合併')) {
                    // 已有改期項目且尚未合併過，合併排程任務和昨日未完成
                    const existingItems = typeof existingTodo.items === 'string'
                        ? JSON.parse(existingTodo.items)
                        : existingTodo.items;
                    let idx = existingItems.length > 0
                        ? Math.max(...existingItems.map((i: any) => i.index)) + 1
                        : 1;

                    carryOverItems.forEach(item => {
                        existingItems.push({ index: idx++, text: `[昨日] ${item}`, done: false });
                    });
                    todayTasks.forEach(t => {
                        const client = t.client_name ? `[${t.client_name}] ` : '';
                        existingItems.push({ index: idx++, text: `${client}${t.task_name}`, done: false });
                    });

                    await supabase
                        .from('agent_daily_todos')
                        .update({
                            items: JSON.stringify(existingItems),
                            total_count: existingItems.length,
                            done_count: existingItems.filter((i: any) => i.done).length,
                            raw_text: existingTodo.raw_text + ' (已合併)',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', existingTodo.id);
                } else if (!existingTodo) {
                    const allItems: { index: number; text: string; done: boolean }[] = [];
                    let idx = 1;

                    carryOverItems.forEach(item => {
                        allItems.push({ index: idx++, text: `[昨日] ${item}`, done: false });
                    });
                    todayTasks.forEach(t => {
                        const client = t.client_name ? `[${t.client_name}] ` : '';
                        allItems.push({ index: idx++, text: `${client}${t.task_name}`, done: false });
                    });

                    await supabase
                        .from('agent_daily_todos')
                        .insert({
                            employee_id: emp.id,
                            employee_name: emp.name,
                            group_id: emp.line_group_id,
                            todo_date: todayStr,
                            items: JSON.stringify(allItems),
                            total_count: allItems.length,
                            done_count: 0,
                            raw_text: '(系統自動建立)'
                        });
                }
            }

            await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    to: emp.line_group_id,
                    messages: [{ type: 'text', text: message.trim() }],
                }),
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Morning reminder error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function GET() {
    return POST();
}

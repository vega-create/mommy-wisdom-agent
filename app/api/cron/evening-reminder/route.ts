export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
    try {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
        const dayOfWeek = now.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const todayStr = now.toLocaleDateString('sv-SE');

        const { data: employees } = await supabase
            .from('agent_employees')
            .select('id, name, line_group_id')
            .eq('is_active', true);

        if (!employees) return NextResponse.json({ success: true });

        for (const emp of employees) {
            if (isWeekend && emp.name !== 'Vega') continue;
            if (!emp.line_group_id) continue;

            // ⭐ 優先查 agent_daily_todos
            const { data: dailyTodo } = await supabase
                .from('agent_daily_todos')
                .select('*')
                .eq('employee_id', emp.id)
                .eq('todo_date', todayStr)
                .single();

            if (dailyTodo) {
                // 用自訂待辦檢查
                const items = typeof dailyTodo.items === 'string'
                    ? JSON.parse(dailyTodo.items)
                    : dailyTodo.items;

                const unfinished = items.filter((i: any) => !i.done);

                if (unfinished.length === 0) continue; // 全部完成，不提醒

                let message = `⏰ ${emp.name}，今天還有任務未完成：\n\n`;
                unfinished.forEach((item: any) => {
                    message += `• ${item.text}\n`;
                });

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
                continue;
            }

            // 沒有 daily_todos → 用舊的 agent_tasks 邏輯
            const todayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];

            const { data: tasks } = await supabase
                .from('agent_tasks')
                .select('id, task_name, client_name, frequency_detail')
                .eq('employee_id', emp.id)
                .eq('is_active', true);

            if (!tasks || tasks.length === 0) continue;

            const todayTasks = tasks.filter(task => {
                const detail = task.frequency_detail || '';
                if (detail === '每天') return true;
                if (detail === '不固定') return false;
                if (detail.includes(todayName)) return true;
                return false;
            });

            const { data: completedToday } = await supabase
                .from('agent_task_records')
                .select('task_id')
                .eq('employee_id', emp.id)
                .gte('completed_at', todayStr);

            const completedIds = (completedToday || []).map(r => r.task_id);
            const unfinishedTasks = todayTasks.filter(t => !completedIds.includes(t.id));

            if (unfinishedTasks.length === 0) continue;

            let message = `⏰ ${emp.name}，今天還有任務未完成：\n\n`;
            unfinishedTasks.forEach(t => {
                message += `• ${t.client_name ? t.client_name + ' – ' : ''}${t.task_name}\n`;
            });

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
        console.error('Evening reminder error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function GET() {
    return POST();
}

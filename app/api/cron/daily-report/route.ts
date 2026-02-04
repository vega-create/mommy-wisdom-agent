export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
    try {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
        const todayDate = now.toLocaleDateString('sv-SE');
        const dayOfWeek = now.getDay();
        const todayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];

        // 取得主管群組
        const { data: managerGroup } = await supabase
            .from('agent_groups')
            .select('line_group_id')
            .eq('group_type', 'manager')
            .eq('is_active', true)
            .single();

        if (!managerGroup) {
            return NextResponse.json({ success: true, message: 'No manager group' });
        }

        // 取得所有員工
        const { data: employees } = await supabase
            .from('agent_employees')
            .select('id, name')
            .eq('is_active', true);

        if (!employees || employees.length === 0) {
            return NextResponse.json({ success: true, message: 'No employees' });
        }

        let reportText = `📊 今日工作日報（${todayDate}）\n\n`;
        let totalDone = 0;
        let totalItems = 0;

        for (const emp of employees) {
            // 先查今天有沒有 po #今日待辦
            const { data: customTodo } = await supabase
                .from('agent_daily_todos')
                .select('*')
                .eq('employee_id', emp.id)
                .eq('todo_date', todayDate)
                .single();

            if (customTodo) {
                // ⭐ 用員工自己的待辦清單
                const items = typeof customTodo.items === 'string'
                    ? JSON.parse(customTodo.items)
                    : customTodo.items;
                const done = items.filter((i: any) => i.done).length;
                const total = items.length;
                const percent = Math.round((done / total) * 100);

                let emoji = '🔴';
                if (percent === 100) emoji = '🟢';
                else if (percent >= 50) emoji = '🟡';

                reportText += `${emoji} ${emp.name}：${done}/${total} (${percent}%)\n`;

                // 列出未完成項目
                const undone = items.filter((i: any) => !i.done);
                if (undone.length > 0) {
                    undone.forEach((item: any) => {
                        reportText += `   ⬜ ${item.text}\n`;
                    });
                }
                reportText += '\n';

                totalDone += done;
                totalItems += total;
            } else {
                // ⭐ 用原本 agent_tasks 排程
                const { data: tasks } = await supabase
                    .from('agent_tasks')
                    .select('id, task_name, client_name, frequency_detail')
                    .eq('employee_id', emp.id)
                    .eq('is_active', true);

                const todayTasks = (tasks || []).filter((task: any) => {
                    const detail = task.frequency_detail || '';
                    if (detail === '每天') return true;
                    if (detail === '不固定') return false;
                    if (detail.includes(todayName)) return true;
                    return false;
                });

                if (todayTasks.length === 0) {
                    reportText += `⚪ ${emp.name}：今日無排程\n\n`;
                    continue;
                }

                // 查今天完成紀錄
                const { data: records } = await supabase
                    .from('agent_task_records')
                    .select('task_id')
                    .eq('employee_id', emp.id)
                    .gte('completed_at', todayDate + 'T00:00:00+08:00')
                    .lte('completed_at', todayDate + 'T23:59:59+08:00');

                const completedIds = new Set((records || []).map((r: any) => r.task_id));
                const done = todayTasks.filter((t: any) => completedIds.has(t.id)).length;
                const total = todayTasks.length;
                const percent = total > 0 ? Math.round((done / total) * 100) : 0;

                let emoji = '🔴';
                if (percent === 100) emoji = '🟢';
                else if (percent >= 50) emoji = '🟡';

                reportText += `${emoji} ${emp.name}：${done}/${total} (${percent}%)\n`;

                // 列出未完成任務
                const undoneTasks = todayTasks.filter((t: any) => !completedIds.has(t.id));
                if (undoneTasks.length > 0) {
                    undoneTasks.forEach((t: any) => {
                        const client = t.client_name ? `[${t.client_name}] ` : '';
                        reportText += `   ⬜ ${client}${t.task_name}\n`;
                    });
                }
                reportText += '\n';

                totalDone += done;
                totalItems += total;
            }
        }

        // 總結
        if (totalItems > 0) {
            const totalPercent = Math.round((totalDone / totalItems) * 100);
            reportText += `──────────\n`;
            reportText += `📈 團隊總完成率：${totalDone}/${totalItems} (${totalPercent}%)`;
        }

        // 發送到主管群
        await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
                to: managerGroup.line_group_id,
                messages: [{ type: 'text', text: reportText.trim() }],
            }),
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Daily report error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function GET() {
    return POST();
}

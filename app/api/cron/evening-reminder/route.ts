export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
    try {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const todayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const todayStr = now.toISOString().split('T')[0];

        const { data: employees } = await supabase
            .from('agent_employees')
            .select('id, name, line_group_id')
            .eq('is_active', true);

        if (!employees) return NextResponse.json({ success: true });

        for (const emp of employees) {
            if (isWeekend && emp.name !== 'Vega') continue;
            if (!emp.line_group_id) continue;

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
                message += `• ${t.client_name ? t.client_name + ' - ' : ''}${t.task_name}\n`;
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

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

async function pushMessage(groupId: string, text: string) {
    await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
            to: groupId,
            messages: [{ type: 'text', text }],
        }),
    });
}

export async function POST() {
    try {
        const { data: managerGroup } = await supabase
            .from('agent_groups')
            .select('line_group_id')
            .eq('group_type', 'manager')
            .eq('is_active', true)
            .single();

        if (!managerGroup?.line_group_id) {
            return NextResponse.json({ success: true, message: 'No manager group' });
        }

        const { data: employees } = await supabase
            .from('agent_employees')
            .select('id, name')
            .eq('is_active', true);

        if (!employees) return NextResponse.json({ success: true });

        const today = new Date().toISOString().split('T')[0];
        let report = `📊 ${today} 每日報表\n\n`;

        for (const emp of employees) {
            const { count: totalTasks } = await supabase
                .from('agent_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('employee_id', emp.id)
                .eq('is_active', true);

            const { count: completedTasks } = await supabase
                .from('agent_task_records')
                .select('*', { count: 'exact', head: true })
                .eq('employee_id', emp.id)
                .gte('completed_at', today);

            const total = totalTasks || 0;
            const completed = completedTasks || 0;
            const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

            report += `👤 ${emp.name}：${completed}/${total} (${rate}%)\n`;
        }

        await pushMessage(managerGroup.line_group_id, report);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Daily report error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function GET() {
    return POST();
}

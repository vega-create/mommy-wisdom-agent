export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const LINE_API_URL = 'https://api.line.me/v2/bot/message/push';

async function pushMessage(groupId: string, text: string) {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    await fetch(LINE_API_URL, {
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

export async function GET() {
    try {
        const { data: groups } = await supabase
            .from('agent_groups')
            .select('line_group_id, employee_id, group_name')
            .eq('group_type', 'employee')
            .eq('is_active', true);

        if (!groups) return NextResponse.json({ success: true });

        const today = new Date().toISOString().split('T')[0];

        for (const group of groups) {
            if (!group.line_group_id || !group.employee_id) continue;

            // 取得員工的任務
            const { data: tasks } = await supabase
                .from('agent_tasks')
                .select('id, task_name, client_name')
                .eq('employee_id', group.employee_id)
                .eq('is_active', true);

            if (!tasks || tasks.length === 0) continue;

            // 取得今日已完成的任務
            const { data: completed } = await supabase
                .from('agent_task_records')
                .select('task_id')
                .eq('employee_id', group.employee_id)
                .gte('completed_at', today);

            const completedIds = (completed || []).map(c => c.task_id);
            const unfinished = tasks.filter(t => !completedIds.includes(t.id));

            if (unfinished.length === 0) {
                await pushMessage(group.line_group_id, '🎉 太棒了！今日任務全部完成！');
            } else {
                let message = '⏰ 下班前提醒，還有未完成：\n';
                unfinished.forEach((task, i) => {
                    message += `${i + 1}. ${task.client_name} - ${task.task_name}\n`;
                });
                message += `\n共 ${unfinished.length} 項待完成`;

                await pushMessage(group.line_group_id, message);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Evening reminder error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
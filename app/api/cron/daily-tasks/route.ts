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

function getTodayTasks(tasks: any[], frequency_detail: string) {
    const today = new Date();
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];
    const dayOfMonth = today.getDate();

    return tasks.filter(task => {
        const detail = task.frequency_detail || '';

        if (task.frequency === 'daily') return true;
        if (task.frequency === 'weekly' && detail.includes(dayOfWeek)) return true;
        if (task.frequency === 'monthly' && detail.includes(`${dayOfMonth}號`)) return true;

        return false;
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

        for (const group of groups) {
            if (!group.line_group_id || !group.employee_id) continue;

            // 取得員工的任務
            const { data: tasks } = await supabase
                .from('agent_tasks')
                .select('*')
                .eq('employee_id', group.employee_id)
                .eq('is_active', true);

            if (!tasks || tasks.length === 0) continue;

            // 篩選今日任務
            const todayTasks = getTodayTasks(tasks, '');

            if (todayTasks.length === 0) {
                await pushMessage(group.line_group_id, '📋 今日沒有排定任務，可以處理其他事項！');
            } else {
                let message = '📋 今日任務：\n';
                todayTasks.forEach((task, i) => {
                    message += `${i + 1}. ${task.client_name} - ${task.task_name}\n`;
                });
                message += `\n共 ${todayTasks.length} 項，加油！💪`;

                await pushMessage(group.line_group_id, message);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Daily tasks error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
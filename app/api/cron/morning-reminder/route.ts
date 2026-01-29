export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
    try {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=日, 1=一, ..., 6=六
        const todayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        // 取得所有員工
        const { data: employees } = await supabase
            .from('agent_employees')
            .select('id, name, line_group_id')
            .eq('is_active', true);

        if (!employees) return NextResponse.json({ success: true });

        for (const emp of employees) {
            // 週末只提醒 Vega
            if (isWeekend && emp.name !== 'Vega') continue;
            if (!emp.line_group_id) continue;

            // 取得該員工的任務
            const { data: tasks } = await supabase
                .from('agent_tasks')
                .select('id, task_name, client_name, frequency_detail')
                .eq('employee_id', emp.id)
                .eq('is_active', true);

            if (!tasks || tasks.length === 0) continue;

            // 篩選今天要做的任務
            const todayTasks = tasks.filter(task => {
                const detail = task.frequency_detail || '';
                if (detail === '每天') return true;
                if (detail === '不固定') return false;
                if (detail.includes(todayName)) return true;
                if (detail.includes('週' + todayName)) return true;
                return false;
            });

            // 查昨天未完成的
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            const { data: completedYesterday } = await supabase
                .from('agent_task_records')
                .select('task_id')
                .eq('employee_id', emp.id)
                .gte('completed_at', yesterdayStr)
                .lt('completed_at', yesterdayStr + 'T23:59:59');

            const completedIds = (completedYesterday || []).map(r => r.task_id);

            // 昨天應該做但沒完成的
            const yesterdayName = ['日', '一', '二', '三', '四', '五', '六'][yesterday.getDay()];
            const unfinishedTasks = tasks.filter(task => {
                const detail = task.frequency_detail || '';
                if (detail === '不固定') return false;
                const shouldDo = detail === '每天' || detail.includes(yesterdayName) || detail.includes('週' + yesterdayName);
                return shouldDo && !completedIds.includes(task.id);
            });

            // 組合訊息
            let message = `📋 ${emp.name} 早安！\n\n`;

            if (unfinishedTasks.length > 0) {
                message += `⚠️ 昨天未完成：\n`;
                unfinishedTasks.forEach(t => {
                    message += `• ${t.client_name ? t.client_name + ' - ' : ''}${t.task_name}\n`;
                });
                message += '\n';
            }

            if (todayTasks.length > 0) {
                message += `📌 今天要做：\n`;
                todayTasks.forEach(t => {
                    message += `• ${t.client_name ? t.client_name + ' - ' : ''}${t.task_name}\n`;
                });
            }

            if (unfinishedTasks.length === 0 && todayTasks.length === 0) {
                continue; // 沒任務就不發
            }

            // 發送 LINE 訊息
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
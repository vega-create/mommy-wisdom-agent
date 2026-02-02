export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
    try {
        // 用台灣時間計算今天星期幾
        const nowUTC = new Date();
        const taiwanOffset = 8 * 60 * 60 * 1000;
        const nowTaiwan = new Date(nowUTC.getTime() + taiwanOffset);

        const dayOfWeek = nowTaiwan.getDay(); // 0=日, 1=一, ..., 6=六
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
                .select('id, task_name, client_name, frequency, frequency_detail')
                .eq('employee_id', emp.id)
                .eq('is_active', true);

            if (!tasks || tasks.length === 0) continue;

            // 篩選今天要做的任務
            const todayDate = nowTaiwan.getDate();
            const todayTasks = tasks.filter(task => {
                const detail = task.frequency_detail || '';
                if (detail === '每天') return true;
                if (detail === '不固定') return false;
                // 週任務
                if (detail.includes(todayName) || detail.includes('週' + todayName)) return true;
                // 月任務（例如 "15號"、"17號"）
                const dayMatch = detail.match(/(\d+)號/);
                if (dayMatch && parseInt(dayMatch[1]) === todayDate) return true;
                return false;
            });

            // 查昨天未完成的（用台灣時間）
            const yesterdayTaiwan = new Date(nowTaiwan);
            yesterdayTaiwan.setDate(yesterdayTaiwan.getDate() - 1);
            // 轉回 UTC 查詢
            const yesterdayStartUTC = new Date(yesterdayTaiwan.getFullYear(), yesterdayTaiwan.getMonth(), yesterdayTaiwan.getDate());
            yesterdayStartUTC.setTime(yesterdayStartUTC.getTime() - taiwanOffset);
            const yesterdayEndUTC = new Date(yesterdayStartUTC.getTime() + 24 * 60 * 60 * 1000);

            const { data: completedYesterday } = await supabase
                .from('agent_task_records')
                .select('task_id')
                .eq('employee_id', emp.id)
                .gte('completed_at', yesterdayStartUTC.toISOString())
                .lt('completed_at', yesterdayEndUTC.toISOString());

            const completedIds = (completedYesterday || []).map(r => r.task_id);

            // 昨天應該做但沒完成的
            const yesterdayName = ['日', '一', '二', '三', '四', '五', '六'][yesterdayTaiwan.getDay()];
            const yesterdayDate = yesterdayTaiwan.getDate();
            const unfinishedTasks = tasks.filter(task => {
                const detail = task.frequency_detail || '';
                if (detail === '不固定') return false;
                let shouldDo = false;
                if (detail === '每天') shouldDo = true;
                if (detail.includes(yesterdayName) || detail.includes('週' + yesterdayName)) shouldDo = true;
                const dayMatch = detail.match(/(\d+)號/);
                if (dayMatch && parseInt(dayMatch[1]) === yesterdayDate) shouldDo = true;
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
                continue;
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

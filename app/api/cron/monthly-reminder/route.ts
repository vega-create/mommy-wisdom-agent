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
        // 取得主管群
        const { data: managerGroup } = await supabase
            .from('agent_groups')
            .select('line_group_id')
            .eq('group_type', 'manager')
            .eq('is_active', true)
            .single();

        if (!managerGroup?.line_group_id) {
            return NextResponse.json({ success: true, message: 'No manager group' });
        }

        const today = new Date();
        const todayDate = today.getDate();

        // 計算明天的日期
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const tomorrowDate = tomorrow.getDate();

        // 取得所有提醒
        const { data: reminders } = await supabase
            .from('agent_reminders')
            .select('*')
            .eq('is_active', true);

        if (!reminders) return NextResponse.json({ success: true });

        const messages: string[] = [];

        for (const reminder of reminders) {
            // 當天提醒
            if (reminder.day_of_month === todayDate) {
                messages.push(`📌 今天要${reminder.title}！`);
            }

            // 前一天提醒
            if (reminder.day_of_month === tomorrowDate) {
                messages.push(`🔔 明天記得${reminder.title}`);
            }
        }

        // 發送訊息
        if (messages.length > 0) {
            await pushMessage(managerGroup.line_group_id, messages.join('\n'));
        }

        return NextResponse.json({ success: true, reminders: messages });
    } catch (error) {
        console.error('Monthly reminder error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
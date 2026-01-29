export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
    try {
        const now = new Date().toISOString();

        const { data: reminders } = await supabase
            .from('agent_reminders')
            .select('*')
            .eq('is_sent', false)
            .lte('reminder_time', now);

        if (!reminders || reminders.length === 0) {
            return NextResponse.json({ success: true, sent: 0 });
        }

        for (const reminder of reminders) {
            await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    to: reminder.group_id,
                    messages: [{ type: 'text', text: reminder.content }],
                }),
            });

            await supabase
                .from('agent_reminders')
                .update({ is_sent: true })
                .eq('id', reminder.id);
        }

        return NextResponse.json({ success: true, sent: reminders.length });
    } catch (error) {
        console.error('Check reminders error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function GET() {
    return POST();
}
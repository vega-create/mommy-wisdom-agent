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
            .select('line_group_id, group_name')
            .eq('group_type', 'employee')
            .eq('is_active', true);

        if (!groups) return NextResponse.json({ success: true });

        for (const group of groups) {
            if (group.line_group_id) {
                await pushMessage(
                    group.line_group_id,
                    '☀️ 早安！請回報昨日工作進度～'
                );
            }
        }

        return NextResponse.json({ success: true, count: groups.length });
    } catch (error) {
        console.error('Morning reminder error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
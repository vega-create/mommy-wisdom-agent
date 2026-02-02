export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const BOSS_USER_ID = 'U9f60f88dca07d665c4ab000bc2d3f5f3';

export async function POST() {
    try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

        const { data: unrepliedMsgs } = await supabase
            .from('agent_customer_messages')
            .select('group_id, group_name')
            .neq('user_id', BOSS_USER_ID)
            .eq('is_replied', false)
            .lte('created_at', twoHoursAgo)
            .order('created_at', { ascending: false });

        if (!unrepliedMsgs || unrepliedMsgs.length === 0) {
            return NextResponse.json({ success: true, reminded: 0 });
        }

        const checkedGroups = new Set<string>();
        const groupsToRemind: { group_id: string; group_name: string }[] = [];

        for (const msg of unrepliedMsgs) {
            if (checkedGroups.has(msg.group_id)) continue;
            checkedGroups.add(msg.group_id);

            const { data: lastCustomerMsg } = await supabase
                .from('agent_customer_messages')
                .select('created_at')
                .eq('group_id', msg.group_id)
                .neq('user_id', BOSS_USER_ID)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            const { data: lastBossReply } = await supabase
                .from('agent_customer_messages')
                .select('created_at')
                .eq('group_id', msg.group_id)
                .eq('user_id', BOSS_USER_ID)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (!lastBossReply ||
                (lastCustomerMsg && lastBossReply.created_at < lastCustomerMsg.created_at)) {
                groupsToRemind.push(msg);
            }
        }

        if (groupsToRemind.length === 0) {
            return NextResponse.json({ success: true, reminded: 0 });
        }

        const { data: managerGroup } = await supabase
            .from('agent_groups')
            .select('line_group_id')
            .eq('group_type', 'manager')
            .eq('is_active', true)
            .single();

        if (managerGroup) {
            let remindText = `⚠️ 以下群組有未回覆訊息：\n\n`;
            groupsToRemind.forEach(g => {
                remindText += `• ${g.group_name}\n`;
            });

            await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    to: managerGroup.line_group_id,
                    messages: [{ type: 'text', text: remindText.trim() }],
                }),
            });
        }

        return NextResponse.json({ success: true, reminded: groupsToRemind.length });
    } catch (error) {
        console.error('Unreplied check error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function GET() {
    return POST();
}

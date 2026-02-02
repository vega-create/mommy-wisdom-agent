export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { openai } from '@/lib/openai';

const BOSS_USER_ID = 'U9f60f88dca07d665c4ab000bc2d3f5f3';

export async function POST() {
    try {
        const now = new Date();
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const monthLabel = `${lastMonthStart.getFullYear()}/${lastMonthStart.getMonth() + 1}`;

        const { data: messages } = await supabase
            .from('agent_customer_messages')
            .select('group_name, message')
            .neq('user_id', BOSS_USER_ID)
            .gte('created_at', lastMonthStart.toISOString())
            .lt('created_at', thisMonthStart.toISOString())
            .order('created_at');

        if (!messages || messages.length === 0) {
            return NextResponse.json({ success: true, message: 'No messages last month' });
        }

        const grouped: { [key: string]: string[] } = {};
        for (const msg of messages) {
            const name = msg.group_name || '未知群組';
            if (!grouped[name]) {
                grouped[name] = [];
            }
            grouped[name].push(msg.message);
        }

        let summaryPrompt = `請為以下客戶群組的 ${monthLabel} 月訊息產生摘要報告。\n\n`;
        for (const [name, msgs] of Object.entries(grouped)) {
            summaryPrompt += `【${name}】共 ${msgs.length} 則訊息：\n`;
            const sample = msgs.slice(0, 50);
            sample.forEach(m => {
                summaryPrompt += `- ${m}\n`;
            });
            if (msgs.length > 50) {
                summaryPrompt += `（還有 ${msgs.length - 50} 則...）\n`;
            }
            summaryPrompt += '\n';
        }

        summaryPrompt += `請用以下格式回覆（簡潔有力）：

每個客戶一段：
📌 客戶名 - X則訊息
主要議題：XXX、XXX、XXX

最後一段：
💡 整體觀察（2-3句話）`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: summaryPrompt }],
            temperature: 0,
        });

        const summary = response.choices[0]?.message?.content || '無法產生摘要';
        const fullSummary = `📊 ${monthLabel} 客戶訊息月報\n\n${summary}`;

        const { data: managerGroup } = await supabase
            .from('agent_groups')
            .select('line_group_id')
            .eq('group_type', 'manager')
            .eq('is_active', true)
            .single();

        if (managerGroup) {
            await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    to: managerGroup.line_group_id,
                    messages: [{ type: 'text', text: fullSummary }],
                }),
            });
        }

        await supabase
            .from('agent_customer_messages')
            .delete()
            .lt('created_at', thisMonthStart.toISOString());

        return NextResponse.json({
            success: true,
            month: monthLabel,
            totalMessages: messages.length,
            groups: Object.keys(grouped).length
        });
    } catch (error) {
        console.error('Monthly summary error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function GET() {
    return POST();
}

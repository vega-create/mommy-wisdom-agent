export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const LINE_API_URL = 'https://api.line.me/v2/bot/message/reply';

async function replyMessage(replyToken: string, text: string) {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    await fetch(LINE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            replyToken,
            messages: [{ type: 'text', text }]
        }),
    });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        console.log('LINE Webhook received:', JSON.stringify(body, null, 2));

        for (const event of body.events || []) {
            const sourceType = event.source?.type;
            const groupId = event.source?.groupId;
            const userId = event.source?.userId;
            const replyToken = event.replyToken;

            // 機器人加入群組 → 記錄 group ID
            if (event.type === 'join') {
                if (groupId) {
                    const { data: existing } = await supabase
                        .from('agent_groups')
                        .select('id')
                        .eq('line_group_id', groupId)
                        .single();

                    if (!existing) {
                        await supabase.from('agent_groups').insert({
                            group_name: '新群組 (待命名)',
                            line_group_id: groupId,
                            group_type: 'employee',
                            is_active: true
                        });
                        console.log('新群組已記錄:', groupId);
                    }

                    // 同時寫入會計系統的表（讓會計系統也能用）
                    const { data: existingAcct } = await supabase
                        .from('acct_line_groups')
                        .select('id')
                        .eq('group_id', groupId)
                        .single();

                    if (!existingAcct) {
                        const { data: company } = await supabase
                            .from('acct_companies')
                            .select('id')
                            .limit(1)
                            .single();

                        if (company) {
                            await supabase.from('acct_line_groups').insert({
                                company_id: company.id,
                                group_id: groupId,
                                group_name: '群組 (自動偵測)',
                                group_type: 'group',
                                is_active: true,
                                description: `AI Agent 自動偵測於 ${new Date().toLocaleString('zh-TW')}`
                            });
                        }
                    }

                    if (replyToken) {
                        await replyMessage(replyToken, '✅ 智慧媽咪 AI 助理已加入！');
                    }
                }
                continue;
            }

            // 文字訊息處理
            if (event.type === 'message' && event.message?.type === 'text') {
                const text = event.message.text.trim();
                const textLower = text.toLowerCase();

                // 查詢 Group ID 指令
                if (textLower === '!groupid' || textLower === '/groupid' || textLower === 'groupid') {
                    if (replyToken) {
                        let reply = '';
                        if (sourceType === 'group' && groupId) {
                            reply = `📋 群組 ID:\n${groupId}`;
                        } else if (sourceType === 'user' && userId) {
                            reply = `📋 用戶 ID:\n${userId}`;
                        } else {
                            reply = '無法取得 ID';
                        }
                        await replyMessage(replyToken, reply);
                    }
                    continue;
                }

                // TODO: AI 語意判斷（之後加）
                // 暫時回覆收到
                console.log('收到訊息:', text);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return NextResponse.json({ error: 'Webhook 處理失敗' }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: 'AI Agent Webhook is ready' });
}
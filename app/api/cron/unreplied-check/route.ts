export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

// ⭐ 已停用：改成每個群組一天只通知一次新訊息，不再發未回覆提醒
export async function POST() {
    return NextResponse.json({ success: true, message: 'Unreplied check disabled' });
}

export async function GET() {
    return POST();
}

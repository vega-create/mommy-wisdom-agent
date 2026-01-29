import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const groupName = searchParams.get('group_name');
    const search = searchParams.get('search');
    const importantOnly = searchParams.get('important') === 'true';

    let query = supabase
        .from('agent_customer_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

    if (startDate) {
        query = query.gte('created_at', startDate);
    }

    if (endDate) {
        query = query.lte('created_at', endDate);
    }

    if (groupName && groupName !== 'all') {
        query = query.eq('group_name', groupName);
    }

    if (search) {
        query = query.ilike('message', `%${search}%`);
    }

    if (importantOnly) {
        query = query.eq('is_important', true);
    }

    const { data: messages, error } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 取得所有群組名稱
    const { data: groups } = await supabase
        .from('agent_customer_messages')
        .select('group_name')
        .order('group_name');

    const uniqueGroups = [...new Set((groups || []).map(g => g.group_name))];

    return NextResponse.json({ messages, groups: uniqueGroups });
}

// 更新訊息（標記重要、加備註）
export async function PUT(request: NextRequest) {
    const body = await request.json();
    const { id, is_important, note } = body;

    const updateData: Record<string, unknown> = {};
    if (typeof is_important === 'boolean') {
        updateData.is_important = is_important;
    }
    if (typeof note === 'string') {
        updateData.note = note;
    }

    const { error } = await supabase
        .from('agent_customer_messages')
        .update(updateData)
        .eq('id', id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        const { data: messages } = await supabase
            .from('agent_customer_messages')
            .select('*')
            .eq('is_replied', false)
            .order('created_at', { ascending: false })
            .limit(50);

        return NextResponse.json({
            messages: messages || [],
        });
    } catch (error) {
        console.error('Messages error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
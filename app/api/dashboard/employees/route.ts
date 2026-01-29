export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        const { data: employees } = await supabase
            .from('agent_employees')
            .select('id, name')
            .eq('is_active', true);

        return NextResponse.json({ employees: employees || [] });
    } catch (error) {
        console.error('Employees error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
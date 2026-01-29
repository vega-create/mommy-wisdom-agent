export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        const { data: employees } = await supabase
            .from('agent_employees')
            .select('id, name')
            .eq('is_active', true);

        const today = new Date().toISOString().split('T')[0];

        const employeeStats = [];
        for (const emp of employees || []) {
            const { count: totalTasks } = await supabase
                .from('agent_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('employee_id', emp.id)
                .eq('is_active', true);

            const { count: completedToday } = await supabase
                .from('agent_task_records')
                .select('*', { count: 'exact', head: true })
                .eq('employee_id', emp.id)
                .gte('completed_at', today);

            employeeStats.push({
                name: emp.name,
                total: totalTasks || 0,
                completed: completedToday || 0,
                rate: totalTasks ? Math.round(((completedToday || 0) / totalTasks) * 100) : 0,
            });
        }

        const { count: unreadMessages } = await supabase
            .from('agent_customer_messages')
            .select('*', { count: 'exact', head: true })
            .eq('is_replied', false);

        return NextResponse.json({
            employeeStats,
            unreadMessages: unreadMessages || 0,
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
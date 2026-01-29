export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        const { data: tasks } = await supabase
            .from('agent_tasks')
            .select(`
                id,
                task_name,
                client_name,
                frequency,
                frequency_detail,
                is_active,
                employee_id,
                agent_employees (name)
            `)
            .order('created_at', { ascending: false });

        const formattedTasks = (tasks || []).map((task: any) => ({
            id: task.id,
            task_name: task.task_name,
            client_name: task.client_name,
            frequency: task.frequency,
            frequency_detail: task.frequency_detail,
            is_active: task.is_active,
            employee_id: task.employee_id,
            employee_name: task.agent_employees?.name || '未指派',
        }));

        return NextResponse.json({ tasks: formattedTasks });
    } catch (error) {
        console.error('Tasks error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { employee_id, client_name, task_name, frequency, frequency_detail } = body;

        const { error } = await supabase.from('agent_tasks').insert({
            employee_id,
            client_name,
            task_name,
            frequency,
            frequency_detail,
            is_active: true,
        });

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Create task error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        }

        const { error } = await supabase
            .from('agent_tasks')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete task error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
export async function PUT(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        const body = await request.json();
        const { employee_id, client_name, task_name, frequency, frequency_detail } = body;

        if (!id) {
            return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        }

        const { error } = await supabase
            .from('agent_tasks')
            .update({
                employee_id,
                client_name,
                task_name,
                frequency,
                frequency_detail,
            })
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update task error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
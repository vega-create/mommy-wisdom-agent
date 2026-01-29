import { openai } from './openai';
import { supabase } from './supabase';

interface ParseResult {
    intent: 'add_task' | 'complete_task' | 'query_tasks' | 'query_progress' | 'unknown';
    employee_name?: string;
    task_name?: string;
    client_name?: string;
    frequency?: string;
    frequency_detail?: string;
    message?: string;
}

export async function parseMessage(text: string, groupType: string): Promise<ParseResult> {
    const prompt = `你是一個任務管理助理。分析以下訊息，判斷意圖並提取資訊。

訊息：「${text}」
群組類型：${groupType}

請回傳 JSON 格式：
{
  "intent": "add_task" | "complete_task" | "query_tasks" | "query_progress" | "unknown",
  "employee_name": "員工名稱（如有）",
  "task_name": "任務名稱（如有）",
  "client_name": "客戶名稱（如有）",
  "frequency": "daily | weekly | monthly | custom（如有）",
  "frequency_detail": "週二,週三 或 每月15號（如有）"
}

範例：
- 「新增雅涵任務，每週三做寵樂芙廣告」→ intent: add_task, employee_name: 雅涵, task_name: 廣告, client_name: 寵樂芙, frequency: weekly, frequency_detail: 週三
- 「寵樂芙廣告完成了」→ intent: complete_task, task_name: 廣告, client_name: 寵樂芙
- 「雅涵今天的任務」→ intent: query_tasks, employee_name: 雅涵
- 「這個月的成效」→ intent: query_progress
- 一般聊天 → intent: unknown

只回傳 JSON，不要其他文字。`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
        });

        const content = response.choices[0]?.message?.content || '{}';
        const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error('AI parse error:', error);
        return { intent: 'unknown' };
    }
}

// 新增任務
export async function addTask(
    employeeName: string,
    taskName: string,
    clientName: string,
    frequency: string,
    frequencyDetail: string
) {
    // 找員工
    const { data: employee } = await supabase
        .from('agent_employees')
        .select('id')
        .eq('name', employeeName)
        .single();

    if (!employee) {
        return { success: false, message: `找不到員工「${employeeName}」` };
    }

    // 新增任務
    const { error } = await supabase.from('agent_tasks').insert({
        task_name: taskName,
        client_name: clientName,
        employee_id: employee.id,
        frequency: frequency || 'weekly',
        frequency_detail: frequencyDetail,
        is_active: true,
    });

    if (error) {
        return { success: false, message: '新增失敗' };
    }

    return {
        success: true,
        message: `✅ 已新增任務！\n👤 ${employeeName}\n📋 ${clientName} - ${taskName}\n🔄 ${frequencyDetail || frequency}`
    };
}

// 完成任務
export async function completeTask(
    employeeId: string,
    taskName: string,
    clientName?: string
) {
    // 找任務
    let query = supabase
        .from('agent_tasks')
        .select('id, task_name, client_name')
        .eq('employee_id', employeeId)
        .eq('is_active', true);

    if (clientName) {
        query = query.ilike('client_name', `%${clientName}%`);
    }
    if (taskName) {
        query = query.ilike('task_name', `%${taskName}%`);
    }

    const { data: tasks } = await query;

    if (!tasks || tasks.length === 0) {
        return { success: false, message: '找不到對應的任務' };
    }

    const task = tasks[0];

    // 記錄完成
    await supabase.from('agent_task_records').insert({
        task_id: task.id,
        employee_id: employeeId,
        completed_at: new Date().toISOString(),
    });

    // 查詢今日剩餘任務數
    const today = new Date().toISOString().split('T')[0];
    const { count } = await supabase
        .from('agent_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId)
        .eq('is_active', true);

    const { count: completedCount } = await supabase
        .from('agent_task_records')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId)
        .gte('completed_at', today);

    const remaining = (count || 0) - (completedCount || 0);

    return {
        success: true,
        message: `✅ 收到！已記錄「${task.client_name} - ${task.task_name}」完成\n📊 今日還剩 ${remaining} 項任務`
    };
}

// 查詢員工任務
export async function getEmployeeTasks(employeeId: string) {
    const { data: tasks } = await supabase
        .from('agent_tasks')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('is_active', true);

    if (!tasks || tasks.length === 0) {
        return '目前沒有任務';
    }

    let message = '📋 任務清單：\n';
    tasks.forEach((task, i) => {
        message += `${i + 1}. ${task.client_name} - ${task.task_name} (${task.frequency_detail || task.frequency})\n`;
    });

    return message;
}
import { openai } from './openai';
import { supabase } from './supabase';

interface ParseResult {
    intent: 'add_task' | 'complete_task' | 'query_tasks' | 'query_progress' | 'send_message' | 'cancel_record' | 'delete_task' | 'update_task' | 'set_reminder' | 'schedule_meeting' | 'unknown';
    employee_name?: string;
    task_name?: string;
    client_name?: string;
    frequency?: string;
    frequency_detail?: string;
    target_group?: string;
    message_content?: string;
    reminder_time?: string;
    reminder_content?: string;
    meeting_date?: string;
    message?: string;
}

export async function parseMessage(text: string, groupType: string): Promise<ParseResult> {
    const prompt = `你是一個任務管理助理。分析以下訊息，判斷意圖並提取資訊。

訊息：「${text}」
群組類型：${groupType}
今天是：${new Date().toLocaleDateString('zh-TW', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

請回傳 JSON 格式：
{
  "intent": "add_task" | "complete_task" | "query_tasks" | "query_progress" | "send_message" | "cancel_record" | "delete_task" | "update_task" | "set_reminder" | "schedule_meeting" | "unknown",
  "employee_name": "員工名稱（如有）",
  "task_name": "任務名稱（如有）",
  "client_name": "客戶名稱（如有）",
  "frequency": "daily | weekly | monthly | custom（如有）",
  "frequency_detail": "週二,週三 或 每月15號（如有）",
  "target_group": "目標群組名稱（如有）",
  "message_content": "要發送的訊息內容（如有）",
  "reminder_time": "提醒時間（如有，例如：15:00、下午3點、14:00）",
  "reminder_content": "提醒內容（如有）",
  "meeting_date": "會議日期（如有，例如：下週三、明天、2/5）"
}

判斷規則：

1. add_task：新增任務
   ✓「新增雅涵任務，每週三做寵樂芙廣告」
   ✓「幫怡婷加一個工作」

2. complete_task：完成任務
   ✓「XXX完成了」「XXX做好了」「XXX OK了」

3. query_tasks：詢問任務
   ✓「雅涵今天的任務」「今天要做什麼」

4. send_message：發送訊息到其他群組
   ✓「到雅涵群說大家辛苦了」
   ✓「跟寵樂芙說報告已完成」

5. cancel_record：取消/撤銷任務完成記錄
   ✓「取消雅涵的工作回報」
   ✓「撤銷剛才的完成記錄」
   ✓「雅涵那個不算」

6. delete_task：刪除任務
   ✓「刪除雅涵的FB貼文任務」
   ✓「把怡婷的圖片製作任務移除」

7. update_task：修改任務（時間、內容）
   ✓「把雅涵的FB貼文改成週二週四」
   ✓「修改怡婷的任務頻率為每天」

8. set_reminder：設定個人提醒（提醒自己，發到主管群）
   ✓「提醒我下午3點開會」
   ✓「30分鐘後提醒我打電話」
   ✓「15:00提醒開會」
   ✓「明天提醒我XXX」

9. schedule_meeting：設定線上會議（發送到客戶/員工群）
   ✓「給寵樂芙設定線上開會，時間是下週三2:00」
   ✓「跟陸居下週四14:00線上會議」
   ✓「安排明天3點跟橙川開會」
   ✓「設定下週三14:00跟寵樂芙開會」
   → target_group 填群組名稱
   → meeting_date 填日期（下週三、明天、2/5）
   → reminder_time 填時間（14:00、2:00、下午2點）

10. unknown：一般聊天、不明確的訊息

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

// 發送訊息到指定群組
export async function sendMessageToGroup(targetGroupName: string, messageContent: string) {
    const { data: group } = await supabase
        .from('agent_groups')
        .select('line_group_id, group_name')
        .ilike('group_name', `%${targetGroupName}%`)
        .single();

    if (!group) {
        return { success: false, message: `找不到群組「${targetGroupName}」` };
    }

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
            to: group.line_group_id,
            messages: [{ type: 'text', text: messageContent }],
        }),
    });

    if (res.ok) {
        return { success: true, message: `✅ 已發送到「${group.group_name}」` };
    } else {
        return { success: false, message: '發送失敗，請稍後再試' };
    }
}

// 取消最近的任務完成記錄
export async function cancelLastRecord(employeeName: string) {
    const { data: employee } = await supabase
        .from('agent_employees')
        .select('id')
        .eq('name', employeeName)
        .single();

    if (!employee) {
        return { success: false, message: `找不到員工「${employeeName}」` };
    }

    const { data: lastRecord } = await supabase
        .from('agent_task_records')
        .select('id, task_id, completed_at')
        .eq('employee_id', employee.id)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

    if (!lastRecord) {
        return { success: false, message: `${employeeName} 沒有完成記錄可以取消` };
    }

    const { data: task } = await supabase
        .from('agent_tasks')
        .select('task_name, client_name')
        .eq('id', lastRecord.task_id)
        .single();

    await supabase
        .from('agent_task_records')
        .delete()
        .eq('id', lastRecord.id);

    return {
        success: true,
        message: `✅ 已取消「${task?.client_name} - ${task?.task_name}」的完成記錄`
    };
}

// 刪除任務
export async function deleteTask(employeeName: string, taskName: string) {
    const { data: employee } = await supabase
        .from('agent_employees')
        .select('id')
        .eq('name', employeeName)
        .single();

    if (!employee) {
        return { success: false, message: `找不到員工「${employeeName}」` };
    }

    const { data: task } = await supabase
        .from('agent_tasks')
        .select('id, task_name, client_name')
        .eq('employee_id', employee.id)
        .ilike('task_name', `%${taskName}%`)
        .single();

    if (!task) {
        return { success: false, message: `找不到任務「${taskName}」` };
    }

    await supabase
        .from('agent_tasks')
        .delete()
        .eq('id', task.id);

    return {
        success: true,
        message: `✅ 已刪除「${task.client_name} - ${task.task_name}」`
    };
}

// 修改任務
export async function updateTask(employeeName: string, taskName: string, newFrequencyDetail: string) {
    const { data: employee } = await supabase
        .from('agent_employees')
        .select('id')
        .eq('name', employeeName)
        .single();

    if (!employee) {
        return { success: false, message: `找不到員工「${employeeName}」` };
    }

    const { data: task } = await supabase
        .from('agent_tasks')
        .select('id, task_name, client_name')
        .eq('employee_id', employee.id)
        .ilike('task_name', `%${taskName}%`)
        .single();

    if (!task) {
        return { success: false, message: `找不到任務「${taskName}」` };
    }

    await supabase
        .from('agent_tasks')
        .update({ frequency_detail: newFrequencyDetail })
        .eq('id', task.id);

    return {
        success: true,
        message: `✅ 已修改「${task.client_name} - ${task.task_name}」\n🔄 新頻率：${newFrequencyDetail}`
    };
}

// 設定提醒
export async function setReminder(reminderTime: string, reminderContent: string, groupId: string) {
    let targetTime: Date;
    
    // 取得台灣時間
    const nowUTC = new Date();
    const taiwanOffset = 8 * 60 * 60 * 1000; // UTC+8
    const nowTaiwan = new Date(nowUTC.getTime() + taiwanOffset);

    // 處理「明天」
    const isTomorrow = reminderTime.includes('明天');

    // 處理「X分鐘後」
    const minutesMatch = reminderTime.match(/(\d+)\s*(分鐘|分)/);
    if (minutesMatch) {
        targetTime = new Date(nowUTC.getTime() + parseInt(minutesMatch[1]) * 60 * 1000);
    }
    // 處理「X小時後」
    else if (reminderTime.match(/(\d+)\s*(小時|時)/)) {
        const hours = parseInt(reminderTime.match(/(\d+)/)?.[1] || '1');
        targetTime = new Date(nowUTC.getTime() + hours * 60 * 60 * 1000);
    }
    // 處理「下午X點」或「15:00」
    else {
        let hour = 9;
        let minute = 0;

        const timeMatch = reminderTime.match(/(\d{1,2}):(\d{2})/);
        const pmMatch = reminderTime.match(/下午\s*(\d{1,2})\s*點?/);
        const amMatch = reminderTime.match(/上午\s*(\d{1,2})\s*點?/);
        const simpleMatch = reminderTime.match(/(\d{1,2})\s*點/);

        if (timeMatch) {
            hour = parseInt(timeMatch[1]);
            minute = parseInt(timeMatch[2]);
        } else if (pmMatch) {
            hour = parseInt(pmMatch[1]);
            if (hour < 12) hour += 12;
        } else if (amMatch) {
            hour = parseInt(amMatch[1]);
        } else if (simpleMatch) {
            hour = parseInt(simpleMatch[1]);
            if (hour < 6) hour += 12;
        }

        // 建立台灣時間的目標時間
        const targetTaiwan = new Date(nowTaiwan);
        
        if (isTomorrow) {
            targetTaiwan.setDate(targetTaiwan.getDate() + 1);
        }
        
        targetTaiwan.setHours(hour, minute, 0, 0);

        // 如果時間已過且不是明天，設為明天
        if (targetTaiwan <= nowTaiwan && !isTomorrow) {
            targetTaiwan.setDate(targetTaiwan.getDate() + 1);
        }

        // 轉回 UTC 存入資料庫
        targetTime = new Date(targetTaiwan.getTime() - taiwanOffset);
    }

    await supabase.from('agent_personal_reminders').insert({
        group_id: groupId,
        reminder_time: targetTime.toISOString(),
        content: reminderContent,
        is_sent: false
    });

    // 顯示用台灣時間
    const displayTime = new Date(targetTime.getTime() + taiwanOffset);
    const dateStr = `${displayTime.getMonth() + 1}/${displayTime.getDate()}`;
    const timeStr = `${displayTime.getHours().toString().padStart(2, '0')}:${displayTime.getMinutes().toString().padStart(2, '0')}`;

    return {
        success: true,
        message: `⏰ 已設定提醒！\n📅 ${dateStr} ${timeStr}\n📝 ${reminderContent}`
    };
}

// 設定線上會議
export async function scheduleMeeting(targetGroupName: string, meetingDate: string, meetingTime: string) {
    // 固定的會議連結
    const MEETING_LINK = 'https://meet.google.com/wta-wwbd-yiw';

    // 取得台灣時間
    const nowUTC = new Date();
    const taiwanOffset = 8 * 60 * 60 * 1000;
    const nowTaiwan = new Date(nowUTC.getTime() + taiwanOffset);

    // 查找群組
    const { data: group } = await supabase
        .from('agent_groups')
        .select('line_group_id, group_name')
        .ilike('group_name', `%${targetGroupName}%`)
        .single();

    if (!group) {
        return { success: false, message: `找不到群組「${targetGroupName}」` };
    }

    // 解析日期
    let targetDate = new Date(nowTaiwan);

    if (meetingDate.includes('明天')) {
        targetDate.setDate(nowTaiwan.getDate() + 1);
    } else if (meetingDate.includes('後天')) {
        targetDate.setDate(nowTaiwan.getDate() + 2);
    } else if (meetingDate.includes('下週') || meetingDate.includes('下周')) {
        const dayMap: { [key: string]: number } = {
            '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0
        };
        const dayMatch = meetingDate.match(/[一二三四五六日]/);
        if (dayMatch) {
            const targetDay = dayMap[dayMatch[0]];
            const currentDay = nowTaiwan.getDay();
            let daysToAdd = targetDay - currentDay;
            if (daysToAdd <= 0) daysToAdd += 7;
            daysToAdd += 7; // 下週
            targetDate.setDate(nowTaiwan.getDate() + daysToAdd);
        }
    } else if (meetingDate.includes('這週') || meetingDate.includes('這周') || meetingDate.includes('週') || meetingDate.includes('周')) {
        const dayMap: { [key: string]: number } = {
            '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0
        };
        const dayMatch = meetingDate.match(/[一二三四五六日]/);
        if (dayMatch) {
            const targetDay = dayMap[dayMatch[0]];
            const currentDay = nowTaiwan.getDay();
            let daysToAdd = targetDay - currentDay;
            if (daysToAdd <= 0) daysToAdd += 7;
            targetDate.setDate(nowTaiwan.getDate() + daysToAdd);
        }
    } else {
        // 嘗試解析 1/30 或 2/5 格式
        const dateMatch = meetingDate.match(/(\d{1,2})\/(\d{1,2})/);
        if (dateMatch) {
            targetDate.setMonth(parseInt(dateMatch[1]) - 1);
            targetDate.setDate(parseInt(dateMatch[2]));
            if (targetDate < nowTaiwan) {
                targetDate.setFullYear(targetDate.getFullYear() + 1);
            }
        }
    }

    // 解析時間
    let hour = 14;
    let minute = 0;

    const timeMatch24 = meetingTime.match(/(\d{1,2}):(\d{2})/);
    const timePM = meetingTime.match(/下午\s*(\d{1,2})\s*點?/);
    const timeAM = meetingTime.match(/上午\s*(\d{1,2})\s*點?/);
    const timeSimple = meetingTime.match(/(\d{1,2})\s*點/);

    if (timeMatch24) {
        hour = parseInt(timeMatch24[1]);
        minute = parseInt(timeMatch24[2]);
    } else if (timePM) {
        hour = parseInt(timePM[1]);
        if (hour < 12) hour += 12;
    } else if (timeAM) {
        hour = parseInt(timeAM[1]);
    } else if (timeSimple) {
        hour = parseInt(timeSimple[1]);
        if (hour >= 1 && hour <= 6) hour += 12;
    }

    targetDate.setHours(hour, minute, 0, 0);

    // 格式化日期時間（台灣時間顯示）
    const dateStr = `${targetDate.getMonth() + 1}/${targetDate.getDate()}`;
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    // 轉回 UTC 存入資料庫
    const targetUTC = new Date(targetDate.getTime() - taiwanOffset);

    // 儲存提醒
    const meetingContent = `【開會提醒】開會囉！\n⏰ 時間：${dateStr} ${timeStr}\n🔗 會議連結：${MEETING_LINK}`;

    await supabase.from('agent_personal_reminders').insert({
        group_id: group.line_group_id,
        reminder_time: targetUTC.toISOString(),
        content: meetingContent,
        is_sent: false
    });

    return {
        success: true,
        message: `✅ 已設定會議提醒！\n👥 ${group.group_name}\n📅 ${dateStr} ${timeStr}\n🔗 ${MEETING_LINK}`
    };
}

// 新增任務
export async function addTask(
    employeeName: string,
    taskName: string,
    clientName: string,
    frequency: string,
    frequencyDetail: string
) {
    const { data: employee } = await supabase
        .from('agent_employees')
        .select('id')
        .eq('name', employeeName)
        .single();

    if (!employee) {
        return { success: false, message: `找不到員工「${employeeName}」` };
    }

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

// 完成任務（智慧比對）
export async function completeTask(employeeId: string, messageText: string) {
    const { data: tasks } = await supabase
        .from('agent_tasks')
        .select('id, task_name, client_name')
        .eq('employee_id', employeeId)
        .eq('is_active', true);

    if (!tasks || tasks.length === 0) {
        return { success: false, message: '你目前沒有任務' };
    }

    const taskList = tasks.map((t, i) =>
        `${i + 1}. ${t.client_name} - ${t.task_name}`
    ).join('\n');

    const prompt = `員工說：「${messageText}」

他的任務列表：
${taskList}

請判斷這句話最可能是完成了哪個任務？
只回覆數字（例如：1），如果都不像就回覆 0`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
        });

        const answer = response.choices[0]?.message?.content?.trim() || '0';
        const taskIndex = parseInt(answer) - 1;

        if (taskIndex < 0 || taskIndex >= tasks.length) {
            return { success: false, message: '找不到對應的任務，可以說清楚一點嗎？' };
        }

        const task = tasks[taskIndex];

        await supabase.from('agent_task_records').insert({
            task_id: task.id,
            employee_id: employeeId,
            completed_at: new Date().toISOString(),
        });

        const today = new Date().toISOString().split('T')[0];
        const { count: completedCount } = await supabase
            .from('agent_task_records')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', employeeId)
            .gte('completed_at', today);

        const remaining = tasks.length - (completedCount || 0);

        return {
            success: true,
            message: `✅ 收到！已記錄「${task.client_name} - ${task.task_name}」完成\n📊 今日還剩 ${remaining} 項任務`
        };
    } catch (error) {
        console.error('AI 比對錯誤:', error);
        return { success: false, message: '系統錯誤，請稍後再試' };
    }
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

// 解析客戶訊息
export async function parseCustomerMessage(text: string): Promise<{
    type: 'urgent' | 'question' | 'payment' | 'general';
    summary: string;
}> {
    const prompt = `你是客服助理。分析客戶訊息，判斷類型並生成簡短摘要。

客戶訊息：「${text}」

類型判斷（請嚴格判斷）：

- urgent（非常嚴格，只有以下情況）：
  ✓ 明確表達憤怒、投訴、要求退款
  ✓ 使用「很急」「馬上」「立刻」「今天一定要」
  ✓ 威脅性語句如「要告」「找律師」「消保官」
  ✗ 一般討論、提醒、建議 → 不是 urgent

- question（有明確疑問）：
  ✓ 使用「請問」「為什麼」「怎麼」「是不是」「可以嗎」
  ✓ 句尾有「？」問號
  ✗ 陳述句 → 不是 question

- payment（付款相關）：
  ✓ 「已匯款」「已轉帳」「付款完成」「給你錢了」
  
- general（預設，大部分訊息都是這個）：
  ✓ 一般對話、討論、閒聊
  ✓ 「好的」「OK」「謝謝」「了解」
  ✓ 提醒、建議、說明
  ✓ 任何不確定的訊息

重要：如果不確定，請選 general。寧可漏報也不要誤報。

摘要規則：
- 用 10 字以內描述重點
- 例如：「課程登入問題」「詢問報價」「已付款通知」「抱怨出貨延遲」

請回傳 JSON：
{
  "type": "urgent | question | payment | general",
  "summary": "簡短摘要（10字內）"
}

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
        console.error('Customer parse error:', error);
        return { type: 'general', summary: '' };
    }
}

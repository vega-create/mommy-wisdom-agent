'use client';

import { useEffect, useState } from 'react';

interface Task {
    id: string;
    task_name: string;
    client_name: string;
    frequency: string;
    frequency_detail: string;
    employee_name: string;
    employee_id: string;
    is_active: boolean;
}

interface Employee {
    id: string;
    name: string;
}

export default function TasksPage() {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        employee_id: '',
        client_name: '',
        task_name: '',
        frequency: 'weekly',
        frequency_detail: '',
    });

    const loadData = () => {
        Promise.all([
            fetch('/api/dashboard/tasks').then((res) => res.json()),
            fetch('/api/dashboard/employees').then((res) => res.json()),
        ]).then(([tasksData, employeesData]) => {
            setTasks(tasksData.tasks || []);
            setEmployees(employeesData.employees || []);
            setLoading(false);
        });
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const url = editingId
            ? '/api/dashboard/tasks?id=' + editingId
            : '/api/dashboard/tasks';
        const method = editingId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
        });
        if (res.ok) {
            setShowForm(false);
            setEditingId(null);
            setFormData({
                employee_id: '',
                client_name: '',
                task_name: '',
                frequency: 'weekly',
                frequency_detail: '',
            });
            loadData();
        }
    };

    const handleEdit = (task: Task) => {
        setEditingId(task.id);
        setFormData({
            employee_id: task.employee_id,
            client_name: task.client_name,
            task_name: task.task_name,
            frequency: task.frequency,
            frequency_detail: task.frequency_detail,
        });
        setShowForm(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('確定要刪除這個任務嗎？')) return;
        const res = await fetch('/api/dashboard/tasks?id=' + id, {
            method: 'DELETE',
        });
        if (res.ok) {
            loadData();
        }
    };

    const handleCancel = () => {
        setShowForm(false);
        setEditingId(null);
        setFormData({
            employee_id: '',
            client_name: '',
            task_name: '',
            frequency: 'weekly',
            frequency_detail: '',
        });
    };

    if (loading) {
        return <div className="text-center py-10 text-gray-500">載入中...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">任務管理</h1>
                <button
                    onClick={() => { setShowForm(!showForm); setEditingId(null); }}
                    style={{ backgroundColor: '#aa162c' }}
                    className="text-white px-4 py-2 rounded-lg hover:opacity-90 transition"
                >
                    {showForm ? '取消' : '+ 新增任務'}
                </button>
            </div>

            {showForm && (
                <div className="bg-white rounded-xl shadow-sm border p-5">
                    <h2 className="font-semibold text-gray-800 mb-4">{editingId ? '編輯任務' : '新增任務'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">員工</label>
                                <select
                                    value={formData.employee_id}
                                    onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200"
                                    required
                                >
                                    <option value="">選擇員工</option>
                                    {employees.map((emp) => (
                                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">客戶名稱</label>
                                <input
                                    type="text"
                                    value={formData.client_name}
                                    onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200"
                                    placeholder="例：寵樂芙"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">任務名稱</label>
                                <input
                                    type="text"
                                    value={formData.task_name}
                                    onChange={(e) => setFormData({ ...formData, task_name: e.target.value })}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200"
                                    placeholder="例：廣告代操"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">頻率</label>
                                <select
                                    value={formData.frequency}
                                    onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200"
                                >
                                    <option value="daily">每日</option>
                                    <option value="weekly">每週</option>
                                    <option value="monthly">每月</option>
                                    <option value="custom">自訂</option>
                                </select>
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">頻率細節</label>
                                <input
                                    type="text"
                                    value={formData.frequency_detail}
                                    onChange={(e) => setFormData({ ...formData, frequency_detail: e.target.value })}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200"
                                    placeholder="例：每週一、週三 或 每月5號 或 不固定"
                                />
                            </div>
                        </div>
                        <div className="flex space-x-2">
                            <button
                                type="submit"
                                style={{ backgroundColor: '#aa162c' }}
                                className="text-white px-6 py-2 rounded-lg hover:opacity-90 transition"
                            >
                                {editingId ? '更新' : '儲存'}
                            </button>
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition"
                            >
                                取消
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {tasks.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-500">
                    目前沒有任務
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead style={{ backgroundColor: '#aa162c10' }}>
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">員工</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">客戶</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">任務</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">頻率</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {tasks.map((task) => (
                                    <tr key={task.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 text-sm text-gray-800">{task.employee_name}</td>
                                        <td className="px-4 py-3 text-sm text-gray-600">{task.client_name}</td>
                                        <td className="px-4 py-3 text-sm text-gray-800">{task.task_name}</td>
                                        <td className="px-4 py-3 text-sm text-gray-600">{task.frequency_detail || task.frequency}</td>
                                        <td className="px-4 py-3 text-sm space-x-3">
                                            <button
                                                onClick={() => handleEdit(task)}
                                                className="text-blue-600 hover:text-blue-800 font-medium"
                                            >
                                                編輯
                                            </button>
                                            <button
                                                onClick={() => handleDelete(task.id)}
                                                style={{ color: '#aa162c' }}
                                                className="hover:opacity-70 font-medium"
                                            >
                                                刪除
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
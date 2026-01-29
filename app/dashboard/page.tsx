'use client';

import { useEffect, useState } from 'react';

interface EmployeeStat {
    name: string;
    total: number;
    completed: number;
    rate: number;
}

export default function DashboardPage() {
    const [employeeStats, setEmployeeStats] = useState<EmployeeStat[]>([]);
    const [unreadMessages, setUnreadMessages] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/dashboard/stats')
            .then((res) => res.json())
            .then((data) => {
                setEmployeeStats(data.employeeStats || []);
                setUnreadMessages(data.unreadMessages || 0);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return <div className="text-center py-10 text-gray-500 text-lg">載入中...</div>;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gray-800">主管總覽</h1>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl shadow-sm border p-5">
                    <p className="text-base text-gray-500">未讀訊息</p>
                    <p className="text-4xl font-bold" style={{ color: '#aa162c' }}>{unreadMessages}</p>
                </div>
                {employeeStats.map((emp) => (
                    <div key={emp.name} className="bg-white rounded-xl shadow-sm border p-5">
                        <p className="text-base text-gray-500">{emp.name} 今日</p>
                        <p className="text-4xl font-bold text-gray-800">{emp.completed}/{emp.total}</p>
                        <p className="text-sm text-gray-400">{emp.rate}% 完成</p>
                    </div>
                ))}
            </div>

            <div className="bg-white rounded-xl shadow-sm border">
                <div className="p-5 border-b">
                    <h2 className="text-xl font-semibold text-gray-800">員工今日進度</h2>
                </div>
                <div className="p-5 space-y-5">
                    {employeeStats.map((emp) => (
                        <div key={emp.name} className="space-y-2">
                            <div className="flex justify-between text-base">
                                <span className="font-medium text-gray-700">{emp.name}</span>
                                <span className="text-gray-500">{emp.completed}/{emp.total} ({emp.rate}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-4">
                                <div
                                    className="h-4 rounded-full transition-all duration-500"
                                    style={{
                                        width: Math.min(emp.rate, 100) + '%',
                                        backgroundColor: '#de3e56'
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <a href="/dashboard/messages" className="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition flex items-center space-x-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: '#aa162c20' }}>
                        <span className="text-3xl">💬</span>
                    </div>
                    <div>
                        <p className="text-lg font-semibold text-gray-800">客戶訊息</p>
                        <p className="text-base text-gray-500">{unreadMessages} 則未回覆</p>
                    </div>
                </a>
                <a href="/dashboard/tasks" className="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition flex items-center space-x-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: '#aa162c20' }}>
                        <span className="text-3xl">📋</span>
                    </div>
                    <div>
                        <p className="text-lg font-semibold text-gray-800">任務管理</p>
                        <p className="text-base text-gray-500">查看所有任務</p>
                    </div>
                </a>
            </div>
        </div>
    );
}
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { issueInvoice, invalidInvoice, EzPayConfig, InvoiceItem } from '@/lib/ezpay';


// 取得公司的 ezPay 設定
async function getEzPayConfig(supabase: any, companyId: string): Promise<EzPayConfig | null> {
  const { data, error } = await supabase
    .from('acct_invoice_settings')
    .select('*')
    .eq('company_id', companyId)
    .single();

  if (error || !data) {
    console.error('Error fetching ezPay config:', error);
    return null;
  }

  return {
    merchantId: data.merchant_id,
    hashKey: data.hash_key,
    hashIV: data.hash_iv,
    isProduction: data.is_production,
  };
}

// 產生發票單號
async function generateInvoiceNumber(supabase: any, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const prefix = `INV${year}${month}`;

  const { data } = await supabase
    .from('acct_invoices')
    .select('id')
    .eq('company_id', companyId)
    .like('invoice_number', `${prefix}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  const nextNum = (data?.length || 0) + 1;
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// GET - 取得發票列表
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('company_id');
    const status = searchParams.get('status');
    const billingId = searchParams.get('billing_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    if (!companyId) {
      return NextResponse.json({ error: '缺少 company_id' }, { status: 400 });
    }

    let query = supabase
      .from('acct_invoices')
      .select(`
        *,
        items:acct_invoice_items(*),
        billing:acct_billing_requests(id, billing_number, status, paid_at),
        customer:acct_customers(id, name, email, tax_id)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (billingId) {
      query = query.eq('billing_request_id', billingId);
    }

    if (startDate) {
      query = query.gte('invoice_date', startDate);
    }

    if (endDate) {
      query = query.lte('invoice_date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Invoices GET error:', error);
      return NextResponse.json({ error: `取得發票失敗: ${error.message}` }, { status: 500 });
    }

    // 查詢關聯的交易記錄
    const invoiceIds = (data || []).map(inv => inv.id);
    let transactions: any[] = [];
    
    if (invoiceIds.length > 0) {
      const { data: txData } = await supabase
        .from('acct_transactions')
        .select('id, invoice_id, amount, transaction_date, description')
        .in('invoice_id', invoiceIds);
      
      transactions = txData || [];
    }

    // 合併交易資訊到發票
    const enrichedData = (data || []).map(invoice => ({
      ...invoice,
      transaction: transactions.find(tx => tx.invoice_id === invoice.id) || null,
    }));

    return NextResponse.json({ data: enrichedData });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json({ error: '取得發票失敗' }, { status: 500 });
  }
}

// POST - 開立發票
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    console.log('Invoice POST body:', body);

    const {
      company_id,
      billing_request_id,
      invoice_type,        // B2B, B2C
      tax_type = 'taxable', // taxable, zero_rate, exempt
      
      // 買受人資訊
      customer_id,
      buyer_name,
      buyer_tax_id,
      buyer_email,
      buyer_phone,
      buyer_address,
      
      // 載具（B2C）
      carrier_type,
      carrier_num,
      love_code,
      
      // 發票內容
      items,
      comment,
      
      // 是否實際開立 ezPay 發票
      issue_to_ezpay = true,
      
      created_by,
    } = body;

    if (!company_id || !buyer_name || !items || items.length === 0) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    // 計算金額
    const taxTypeCode = tax_type === 'taxable' ? '1' : tax_type === 'zero_rate' ? '2' : '3';
    const taxRate = taxTypeCode === '1' ? 0.05 : 0;
    
    const totalAmount = items.reduce((sum: number, item: any) => {
      return sum + (item.price * item.quantity);
    }, 0);
    
    const salesAmount = Math.round(totalAmount / (1 + taxRate));
    const taxAmount = totalAmount - salesAmount;

    // 產生訂單編號
    const orderNumber = `ORD${Date.now().toString(36).toUpperCase()}`;

    let invoiceNumber = null;
    let invoiceDate = new Date().toISOString().split('T')[0];
    let randomNum = null;
    let transNum = null;
    let ezpayResponse = null;
    let status = 'draft';

    // 如果要開立 ezPay 發票
    if (issue_to_ezpay) {
      const config = await getEzPayConfig(supabase, company_id);
      if (!config) {
        return NextResponse.json({ error: '未設定 ezPay API，請先至設定頁面設定' }, { status: 400 });
      }

      // 轉換項目格式
      const ezpayItems: InvoiceItem[] = items.map((item: any) => ({
        name: item.name,
        count: item.quantity,
        unit: item.unit || '式',
        price: item.price,
        amount: item.price * item.quantity,
        taxType: taxTypeCode,
      }));

      // 呼叫 ezPay API
      const result = await issueInvoice(config, {
        orderNumber,
        invoiceType: invoice_type,
        buyerName: buyer_name,
        buyerTaxId: buyer_tax_id,
        buyerEmail: buyer_email,
        buyerPhone: buyer_phone,
        buyerAddress: buyer_address,
        carrierType: carrier_type,
        carrierNum: carrier_num,
        loveCode: love_code,
        items: ezpayItems,
        taxType: taxTypeCode,
        comment,
      });

      if (!result.success) {
        return NextResponse.json({ 
          error: `ezPay 開立失敗: ${result.message}`,
          rawResponse: result.rawResponse 
        }, { status: 400 });
      }

      invoiceNumber = result.invoiceNumber;
      invoiceDate = result.invoiceDate?.split(' ')[0] || invoiceDate;
      randomNum = result.randomNum;
      transNum = result.transNum;
      ezpayResponse = result.rawResponse;
      status = 'issued';
    }

    // 儲存到資料庫
    const { data: invoice, error: insertError } = await supabase
      .from('acct_invoices')
      .insert({
        company_id,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        customer_id,
        buyer_name,
        buyer_tax_id,
        buyer_email,
        buyer_phone,
        buyer_address,
        invoice_type,
        tax_type,
        sales_amount: salesAmount,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        status,
        billing_request_id,
        ezpay_trans_num: transNum,
        ezpay_random_num: randomNum,
        ezpay_response: ezpayResponse,
        created_by,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Invoice insert error:', insertError);
      return NextResponse.json({ error: `儲存發票失敗: ${insertError.message}` }, { status: 500 });
    }

    // 儲存發票明細
    const invoiceItems = items.map((item: any, index: number) => ({
      invoice_id: invoice.id,
      item_name: item.name,
      quantity: item.quantity,
      unit: item.unit || '式',
      unit_price: item.price,
      amount: item.price * item.quantity,
      sort_order: index,
    }));

    const { error: itemsError } = await supabase
      .from('acct_invoice_items')
      .insert(invoiceItems);

    if (itemsError) {
      console.error('Invoice items insert error:', itemsError);
    }

    // 更新請款單的發票狀態
    if (billing_request_id) {
      await supabase
        .from('acct_billing_requests')
        .update({ 
          invoice_id: invoice.id,
          invoice_number: invoiceNumber,
          invoice_status: status === 'issued' ? 'issued' : 'pending',
        })
        .eq('id', billing_request_id);
    }

    // 開票成功後發送 LINE 群組通知
    if (status === 'issued') {
      try {
        const { data: lineSettings } = await supabase
          .from('acct_line_settings')
          .select('channel_access_token, admin_group_id')
          .eq('company_id', company_id)
          .eq('is_active', true)
          .single();

        if (lineSettings?.channel_access_token && lineSettings?.admin_group_id) {
          const message = `📄 發票開立通知

🧾 發票號碼：${invoiceNumber}
👤 買受人：${buyer_name}${buyer_tax_id ? `\n🏢 統編：${buyer_tax_id}` : ''}
💰 金額：NT$ ${totalAmount.toLocaleString()}
📧 類型：${invoice_type}

${buyer_email ? `✉️ 發票已自動寄送至 ${buyer_email}` : '⚠️ 未設定 Email，請手動通知客戶'}`;

          await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${lineSettings.channel_access_token}`,
            },
            body: JSON.stringify({
              to: lineSettings.admin_group_id,
              messages: [{ type: 'text', text: message }],
            }),
          });
        }
      } catch (lineError) {
        console.error('LINE notification error:', lineError);
        // LINE 通知失敗不影響主流程
      }
    }

    return NextResponse.json({ 
      success: true, 
      data: invoice,
      message: status === 'issued' ? '發票開立成功' : '發票草稿已儲存',
    });
  } catch (error) {
    console.error('Error creating invoice:', error);
    return NextResponse.json({ 
      error: `開立發票失敗: ${error instanceof Error ? error.message : '未知錯誤'}` 
    }, { status: 500 });
  }
}

// PUT - 作廢發票
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, action, void_reason } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    // 取得發票資料
    const { data: invoice, error: fetchError } = await supabase
      .from('acct_invoices')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ error: '找不到發票' }, { status: 404 });
    }

    if (action === 'void') {
      // 作廢發票
      if (invoice.status !== 'issued') {
        return NextResponse.json({ error: '只能作廢已開立的發票' }, { status: 400 });
      }

      if (!void_reason) {
        return NextResponse.json({ error: '請填寫作廢原因' }, { status: 400 });
      }

      // 如果有 ezPay 發票號碼，呼叫作廢 API
      if (invoice.invoice_number && invoice.ezpay_trans_num) {
        const config = await getEzPayConfig(supabase, invoice.company_id);
        if (config) {
          const result = await invalidInvoice(config, {
            invoiceNumber: invoice.invoice_number,
            invalidReason: void_reason,
          });

          if (!result.success) {
            return NextResponse.json({ 
              error: `ezPay 作廢失敗: ${result.message}`,
              rawResponse: result.rawResponse 
            }, { status: 400 });
          }
        }
      }

      // 更新資料庫
      const { error: updateError } = await supabase
        .from('acct_invoices')
        .update({
          status: 'void',
          void_at: new Date().toISOString(),
          void_reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        return NextResponse.json({ error: `更新失敗: ${updateError.message}` }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: '發票已作廢' });
    }

    return NextResponse.json({ error: '不支援的操作' }, { status: 400 });
  } catch (error) {
    console.error('Error updating invoice:', error);
    return NextResponse.json({ error: '操作失敗' }, { status: 500 });
  }
}

// DELETE - 刪除草稿發票
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    // 檢查是否為草稿
    const { data: invoice } = await supabase
      .from('acct_invoices')
      .select('status')
      .eq('id', id)
      .single();

    if (invoice?.status !== 'draft') {
      return NextResponse.json({ error: '只能刪除草稿發票' }, { status: 400 });
    }

    // 刪除明細
    await supabase
      .from('acct_invoice_items')
      .delete()
      .eq('invoice_id', id);

    // 刪除發票
    const { error } = await supabase
      .from('acct_invoices')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: `刪除失敗: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ error: '刪除失敗' }, { status: 500 });
  }
}

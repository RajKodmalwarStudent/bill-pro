// ============================================================
//  BillPro — Database Layer (Supabase)
//  All CRUD operations go through this module.
// ============================================================

/* global supabase, SUPABASE_URL, SUPABASE_ANON_KEY */

const DB = (() => {
  'use strict';

  let _client = null;

  function _client_() {
    if (!_client) {
      if (typeof supabase === 'undefined') {
        throw new Error('Supabase SDK not loaded. Check your internet connection.');
      }
      if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
        throw new Error('Open config.js and fill in your Supabase URL and anon key.');
      }
      _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _client;
  }

  // ── Stocks ─────────────────────────────────────────────────

  async function loadStocks() {
    const { data, error } = await _client_()
      .from('stocks')
      .select('*')
      .order('id');
    if (error) throw new Error('Could not load stocks: ' + error.message);
    return data;
  }

  async function insertStock(stock) {
    const { data, error } = await _client_()
      .from('stocks')
      .insert(stock)
      .select()
      .single();
    if (error) throw new Error('Could not add stock: ' + error.message);
    return data;
  }

  async function updateStock(id, changes) {
    const { data, error } = await _client_()
      .from('stocks')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error('Could not update stock: ' + error.message);
    return data;
  }

  async function deleteStock(id) {
    const { error } = await _client_()
      .from('stocks')
      .delete()
      .eq('id', id);
    if (error) throw new Error('Could not delete stock: ' + error.message);
  }

  // ── Bills ──────────────────────────────────────────────────

  function _mapBill(row) {
    return {
      id:     row.id,
      time:   new Date(row.billed_at),
      items:  row.items,
      sub:    parseFloat(row.subtotal),
      disc:   parseFloat(row.discount_pct),
      da:     parseFloat(row.discount_amt),
      tot:    parseFloat(row.total),
      profit: parseFloat(row.profit),
    };
  }

  async function loadBills() {
    const { data, error } = await _client_()
      .from('bills')
      .select('*')
      .order('billed_at', { ascending: false });
    if (error) throw new Error('Could not load bills: ' + error.message);
    return data.map(_mapBill);
  }

  async function insertBill(bill) {
    const { error } = await _client_()
      .from('bills')
      .insert({
        id:           bill.id,
        billed_at:    bill.time.toISOString(),
        items:        bill.items,
        subtotal:     bill.sub,
        discount_pct: bill.disc,
        discount_amt: bill.da,
        total:        bill.tot,
        profit:       bill.profit,
      });
    if (error) throw new Error('Could not save bill: ' + error.message);
  }

  async function getNextBillNumber() {
    const { count, error } = await _client_()
      .from('bills')
      .select('*', { count: 'exact', head: true });
    if (error) throw new Error('Could not fetch bill count: ' + error.message);
    return (count || 0) + 1;
  }

  return { loadStocks, insertStock, updateStock, deleteStock, loadBills, insertBill, getNextBillNumber };
})();

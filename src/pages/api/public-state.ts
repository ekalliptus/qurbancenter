import type { APIContext } from 'astro';
import { getDayState, defaultDayState } from '../../lib/db';
import { getEnv } from '../../lib/env';

export async function GET({ url }: APIContext) {
  const API_KEY = getEnv('PUBLIC_API_KEY');
  const key = url.searchParams.get('key');
  if (!API_KEY || key !== API_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const day = parseInt(url.searchParams.get('day') || '1');
    if (day < 1 || day > 4) {
      return new Response(JSON.stringify({ error: 'Invalid day' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const raw = await getDayState(day);
    const state = raw || defaultDayState();

    const kandang = (state as any).kandang || [];
    let totalKeluar = 0;
    for (const k of kandang) totalKeluar += (k.keluar || 0);

    const sembelih = (state as any).sembelih || [];
    let totalDipotong = 0;
    const sembelihDetail: number[] = [];
    for (const s of sembelih) {
      const v = s.dipotong || 0;
      totalDipotong += v;
      sembelihDetail.push(v);
    }

    const lane = (state as any).lane || [];
    let totalDikuliti = 0;
    for (const ln of lane) totalDikuliti += (ln.total || 0);

    const cacah = (state as any).cacah || [];
    let totalCacah = 0;
    for (const c of cacah) totalCacah += (c.total || 0);

    const flat = {
      totalHewan: (state as any).totalHewan || 0,
      tanggal: (state as any).tanggal || '',
      waktuMulai: (state as any).waktuMulai || '',
      waktuSelesai: (state as any).waktuSelesai || '',
      totalKeluar,
      kandangMulai: kandang[0]?.waktuMulai || '',
      kandangSelesai: kandang[0]?.waktuSelesai || '',
      totalDipotong,
      sembelihDetail,
      sembelihMulai: sembelih[0]?.waktuMulai || '',
      sembelihSelesai: sembelih[0]?.waktuSelesai || '',
      totalDikuliti,
      pengulitanMulai: (state as any).pengulitanMulai || '',
      pengulitanSelesai: (state as any).pengulitanSelesai || '',
      karkas: (state as any).karkas?.total || 0,
      karkasMulai: (state as any).karkas?.waktuMulai || '',
      karkasSelesai: (state as any).karkas?.waktuSelesai || '',
      abfKeluar: (state as any).abf?.keluar || 0,
      abfMulai: (state as any).abf?.waktuMulai || '',
      abfSelesai: (state as any).abf?.waktuSelesai || '',
      totalCacah,
      cacahDariAbf: (state as any).cacahDariAbf || 0,
      cacahMulai: cacah[0]?.waktuMulai || '',
      cacahSelesai: cacah[0]?.waktuSelesai || '',
      packingKecil: (state as any).packingKecil?.total || 0,
      packingKecilMulai: (state as any).packingKecil?.waktuMulai || '',
      packingKecilSelesai: (state as any).packingKecil?.waktuSelesai || '',
      packingKarkasDomba: (state as any).packingKarkas?.domba || 0,
      packingKarkasSapi: (state as any).packingKarkas?.sapi || 0,
      packingKarkasMulai: (state as any).packingKarkas?.waktuMulai || '',
      packingKarkasSelesai: (state as any).packingKarkas?.waktuSelesai || '',
      transitKakiKepala: (state as any).transit?.kakiKepala || 0,
      transitMulai: (state as any).transit?.waktuMulai || '',
      transitSelesai: (state as any).transit?.waktuSelesai || '',
      distribusiKecilLokasi: ((state as any).distribusiKecil?.lokasi || []).map((l: any) => ({
        nama: l.nama || '', jumlah: l.jumlah || 0, status: l.status || '',
      })),
      distribusiKecilMulai: (state as any).distribusiKecil?.waktuMulai || '',
      distribusiKecilSelesai: (state as any).distribusiKecil?.waktuSelesai || '',
      distribusiKarkasDomba: (state as any).distribusiKarkas?.domba || 0,
      distribusiKarkasSapi: (state as any).distribusiKarkas?.sapi || 0,
      distribusiKarkasSelesaiDomba: (state as any).distribusiKarkas?.selesaiDomba || 0,
      distribusiKarkasSelesaiSapi: (state as any).distribusiKarkas?.selesaiSapi || 0,
      distribusiKarkasMulai: (state as any).distribusiKarkas?.waktuMulai || '',
      distribusiKarkasSelesai: (state as any).distribusiKarkas?.waktuSelesai || '',
    };

    return new Response(JSON.stringify(flat), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e: any) {
    console.error('GET /api/public-state error:', e);
    return new Response(JSON.stringify({ error: 'Terjadi kesalahan' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

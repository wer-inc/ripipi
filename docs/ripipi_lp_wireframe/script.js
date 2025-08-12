// Ripipi LP wireframe interactions & AB/segment switches
(function(){
  const params = new URLSearchParams(location.search);

  // --- Segments ---
  const seg = params.get('seg') || 'beauty'; // beauty | seitai | food
  const segMap = {
    beauty: {
      badge: '美容室・サロン向け',
      featuresExtra: [
        'スタッフ指名・所要時間・回数券を強調'
      ]
    },
    seitai: {
      badge: '整体・治療院向け',
      featuresExtra: [
        '初診/再診・問診票・回数券を強調'
      ]
    },
    food: {
      badge: '飲食・順番待ち向け',
      featuresExtra: [
        '当日順番待ち・人数・呼び出し通知を強調'
      ]
    }
  };

  // --- Hero variants ---
  const variant = (params.get('variant') || 'a').toLowerCase(); // a | b | c
  const variants = {
    a: {
      title: 'LINEだけで「予約・順番待ち・会員証」',
      sub: '前日・直前リマインドで<strong class="em">当日キャンセルを自動で減らす</strong>。最短3営業日で開始。',
      ctaPrimary: '15分デモを予約',
      ctaSecondary: 'デモQRで体験'
    },
    b: {
      title: 'アプリ不要、今日から“LINE予約”',
      sub: 'ノーショー▲30%・再来＋10%の仕組みを<strong class="em">1枚のQR</strong>で。',
      ctaPrimary: 'QRを受け取る',
      ctaSecondary: '料金を見る'
    },
    c: {
      title: '予約管理、もうLINEだけでいい',
      sub: '会員証・回数券・多言語も、<strong class="em">お店の負担ゼロ</strong>で。',
      ctaPrimary: '無料相談（15分）',
      ctaSecondary: 'デモを見る'
    }
  };

  // Inject segment badge
  const segConf = segMap[seg] || segMap.beauty;
  document.getElementById('heroBadge').textContent = segConf.badge;

  // Inject hero variant copy
  const v = variants[variant] || variants.a;
  document.getElementById('heroTitle').textContent = v.title;
  document.getElementById('heroSub').innerHTML = v.sub;
  document.getElementById('heroCtaPrimary').textContent = v.ctaPrimary;
  document.getElementById('heroCtaSecondary').textContent = v.ctaSecondary;

  // Optional: pricing visibility toggle
  const showPricing = params.get('showPricing');
  if (showPricing === 'false') {
    document.getElementById('pricing').style.display = 'none';
  }

  // Optional: primary CTA type (demo | qr)
  const ctaPref = params.get('cta');
  if (ctaPref === 'qr') {
    // Swap primary/secondary roles
    const primary = document.getElementById('heroCtaPrimary');
    const secondary = document.getElementById('heroCtaSecondary');
    const parent = primary.parentElement;
    parent.insertBefore(secondary, primary);
  }

  // --- ROI calc ---
  const bookings = document.getElementById('roiBookings');
  const price = document.getElementById('roiPrice');
  const before = document.getElementById('roiNoShowBefore');
  const after = document.getElementById('roiNoShowAfter');
  const result = document.getElementById('roiResult');
  const calcBtn = document.getElementById('roiCalcBtn');

  function formatJPY(n){
    return '¥' + (Math.round(n)).toLocaleString('ja-JP');
  }

  function calc(){
    const b = Math.max(0, Number(bookings.value || 0));
    const p = Math.max(0, Number(price.value || 0));
    const nb = Math.min(100, Math.max(0, Number(before.value || 0))) / 100;
    const na = Math.min(100, Math.max(0, Number(after.value || 0))) / 100;
    const delta = Math.max(0, nb - na);
    const yen = b * p * delta;
    result.innerHTML = '削減見込額/月：<strong>' + formatJPY(yen) + '</strong>';
  }

  calcBtn.addEventListener('click', function(){
    calc();
    track('roi_calc');
  });

  // simple autocalc on input
  [bookings, price, before, after].forEach(el => el.addEventListener('input', calc));

  // --- Tracking stubs (GA等はプロジェクトで差し替え) ---
  window.track = function(name){
    // ここで gtag('event', name, {...}) 等に差し替え
    console.log('[track]', name);
  };

  document.querySelectorAll('[data-track]').forEach(el => {
    el.addEventListener('click', () => track(el.dataset.track));
  });
})();
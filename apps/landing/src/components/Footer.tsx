export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-4 h-4 rounded-full bg-emerald-500"></span>
              <span className="font-bold text-white text-lg">Ripipi</span>
            </div>
            <p className="text-sm">
              LINEで完結する<br />
              次世代の予約管理システム
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold text-white mb-3">サービス</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#features" className="hover:text-white transition-colors">機能一覧</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">料金プラン</a></li>
              <li><a href="#demo" className="hover:text-white transition-colors">デモ予約</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold text-white mb-3">導入業種</h4>
            <ul className="space-y-2 text-sm">
              <li>美容室・サロン</li>
              <li>整体・治療院</li>
              <li>飲食店</li>
              <li>その他サービス業</li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold text-white mb-3">お問い合わせ</h4>
            <div className="space-y-3">
              <a
                href="#demo"
                className="inline-block bg-emerald-500 text-white px-6 py-2 rounded-lg hover:bg-emerald-600 transition-colors text-sm font-medium"
              >
                15分デモを予約
              </a>
              <div className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <span>03-1234-5678</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>info@ripipi.com</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-sm mb-4 md:mb-0">
            © 2024 Ripipi. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm">
            <a href="#" className="hover:text-white transition-colors">利用規約</a>
            <a href="#" className="hover:text-white transition-colors">プライバシーポリシー</a>
            <a href="#" className="hover:text-white transition-colors">特定商取引法</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
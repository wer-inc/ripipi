export default function Process() {
  const steps = [
    {
      number: "1",
      title: "15分オンライン",
      description: "要件ヒアリング",
    },
    {
      number: "2",
      title: "初期設定",
      description: "メニュー/枠/文言を代行",
    },
    {
      number: "3",
      title: "テスト予約",
      description: "スタッフで動作確認",
    },
    {
      number: "4",
      title: "公開",
      description: "QR掲示・SNS誘導",
    },
  ];

  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          導入の流れ
        </h2>
        <div className="grid md:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <div key={index} className="text-center">
              <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                {step.number}
              </div>
              <h3 className="font-bold mb-2">{step.title}</h3>
              <p className="text-gray-600 text-sm">{step.description}</p>
            </div>
          ))}
        </div>
        <p className="text-center mt-8 text-gray-600">
          最短3営業日で公開可能
        </p>
      </div>
    </section>
  );
}
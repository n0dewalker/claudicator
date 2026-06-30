import { useEffect, type RefObject } from 'react'

// ウィンドウ高さの自動追従。過去に「タブ切替・ボタン押下のたびにウィンドウが
// 数 px ずつ伸びていく」ドリフトバグが繰り返し再発した経緯がある。
// 恒久対策として下記 3 点を不可分にまとめる：
//   - rAF コアレッシング: 同一フレーム内の複数 ResizeObserver 発火を 1 回に集約
//   - 前回送信値ガード: 同じ高さなら IPC を発火しない（フィードバックループ遮断）
//   - main 側は setSize ではなく setContentSize + Math.round を使うこと（chrome 計算と
//     ceil 非対称が組み合わさるとドリフトする）。main 側の handlers.ts も対で守ること。
//
// ── 現在の利用状況（2026-05-14）──
// このフックは現在 claudicator のどの MainView からも呼び出されていない。
// タブ化後に hide/show・タブ切替でウィンドウ寸法が DPI 端数ドリフトする問題が再発したため、
// 自動リサイズを切断し tray/TrayController.ts の固定 WIN_H 運用に切り替えた。
// 根本原因は renderer の offsetHeight 自体が DPI 丸めで揺れること、および
// getContentSize() の読み戻しが幅軸ドリフトを起こすことの 2 点（ループ中断だけでは不十分）。
// 将来このフックを再有効化する場合は、別途整備するダミーアプリ
// （electron-resize-sandbox/ など）で DPI ドリフト防止策を完全に検証した上で行うこと。
// 安易な再配線は同じバグを再発させる。
export function useWindowAutoResize(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    let lastSent = -1
    let rafId = 0
    const fire = () => {
      rafId = 0
      const h = el.offsetHeight
      if (h === lastSent) return
      lastSent = h
      window.electronAPI.resizeWindow(h)
    }
    const observer = new ResizeObserver(() => {
      if (rafId !== 0) return
      rafId = requestAnimationFrame(fire)
    })
    observer.observe(el)
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [enabled, ref])
}

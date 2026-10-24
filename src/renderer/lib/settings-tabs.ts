// settings-tabs.ts：设置导航纵向 tablist 的纯键盘导航规则（方向键/Home/End + 环绕）
// 边界：只算下一个焦点下标，不读写 DOM；DOM 查询与 focus() 在 SettingsDialog 组装层。

/** 由方向键/Home/End 计算下一个应聚焦的 tab 下标（纵向 tablist，首尾环绕） */
export function resolveNextTabIndex(key: string, currentIndex: number, length: number): number {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return length - 1;
  }
  if (key === 'ArrowDown') {
    return currentIndex === -1 || currentIndex === length - 1 ? 0 : currentIndex + 1;
  }
  return currentIndex <= 0 ? length - 1 : currentIndex - 1;
}

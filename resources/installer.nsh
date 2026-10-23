; resources/installer.nsh
; 自定义 NSIS 脚本（经 electron-builder 的 nsis.include 注入）
; ══════════════════════════════════════════════════════════════════════════
;
; ⚠️ 两条注入期陷阱（实测，改本文件前先读）：
;   1. 本脚本被注入到生成脚本的**最前面**，早于模板里的 multiUser.nsh。
;      因此不能引用 ${INSTALL_REGISTRY_KEY} / ${UNINSTALL_REGISTRY_KEY} 等由
;      multiUser.nsh 之后才定义的常量（编译期即失败）。
;   2. `pnpm build:win:x64` 把 NSIS 警告当**错误**处理。任何宏内未使用变量、
;      无效 `!ifdef` 都会中断打包——本地改完必须真跑一次打包验证，不能只看 lint。
;
; 目的：旧版本卸载失败时**不要中断安装**。
;
; 背景（2026-09-20 实测根因）：NSIS 卸载器在「更新模式」（--updated）下不直接
; 删除文件，而是把每个文件重命名到 `$PLUGINSDIR\old-install\<相对路径>`
; （uninstaller.nsh 的 un.atomicRMDir）。任一重命名失败即 Abort（退出码 2）；
; 安装器侧 handleUninstallResult 检测到非 0 退出码就弹
; 「Failed to uninstall old application files. Please try running the installer
; again.」并 Quit —— 用户被卡死，无法升级。
;
; 触发条件（已用真实 makensis 复现）：安装目录内最深相对路径 206 字符时，
; 重命名目标 = $PLUGINSDIR（实测 45）+ `\old-install\`（13）+ 206 = 264 > MAX_PATH 260，
; 于是 CreateDirectory/Rename 均 FAILED（短路径对照 OK，证明是长度而非占用）。
; 生成侧缓解：控制 asar.unpacked 内的深层 node_modules 路径长度（模板默认依赖树
; 远未触及该上限；接入深层依赖链后建议加一条打包期路径长度断言，fail-closed）。
;
; 为什么还要这个逃生舱：路径长度只是「已知的一种」旧卸载器失败原因（文件被占用、
; 权限、磁盘错误同样会让它返回非 0）。安装新版本时把旧版本卸载干净是**优化**而非
; 正确性前提——新版安装器本就会覆盖安装目录内的全部文件。因此卸载失败时应记录并
; 继续，而不是把用户挡在门外。
;
; 挂钩语义（app-builder-lib installUtil.nsh:108-134）：一旦定义了
; `customUnInstallCheck`（或 per-machine 的 `customUnInstallCheckCurrentUser`），
; handleUninstallResult 会调用它并**直接返回**——完全接管原本的
; 「$R0 != 0 → 弹窗 → SetErrorLevel 2 → Quit」逻辑。$R0 是旧卸载器的退出码。
;
; ⚠️ 三个实现约束（均由 makensis 编译验证得出，勿踩）：
;   1. 本文件被注入到 generated script 的**最前面**（NsisTarget.computeFinalScript:
;      scriptGenerator.build() + originalScript），早于模板里的 multiUser.nsh
;      （它才定义 ${INSTALL_REGISTRY_KEY} / ${UNINSTALL_REGISTRY_KEY}）。
;      故本文件**不能引用这些常量**，否则触发 makensis 的 "unknown variable"
;      警告（本项目警告视为错误 → 编译失败）。清理只依赖 $INSTDIR。
;   2. 清理必须放在**安装器**侧的钩子里：卸载失败走的是 Abort，卸载器直接中止，
;      写在 customUnInstall（卸载器段）里的代码根本不会执行。
;   3. 清理逻辑**内联在宏体内**而不是独立 Function：NSIS 的
;      "install function not referenced" 检查发生在宏展开之前，宏内 Call 的
;      函数会被误判为未引用而报错（同样使编译失败）。内联后无此问题。
; ══════════════════════════════════════════════════════════════════════════

!include "LogicLib.nsh"
!include "FileFunc.nsh"

; Windows 协议注册（init:template 会同步本行到派生项目的协议）
;
; electron-builder 的 `protocols` 配置只对 macOS 生效；Windows 上应用运行时经
; app.setAsDefaultProtocolClient 写 HKCU，NSIS 卸载器并不知道这个键。这里由安装器
; 显式注册、卸载器显式删除，避免卸载后残留指向已删除 exe 的协议。
!define APP_PROTOCOL "electron-template"

!macro customInstall
  WriteRegStr HKCU "Software\Classes\${APP_PROTOCOL}" "" "URL:${PRODUCT_NAME} Protocol"
  WriteRegStr HKCU "Software\Classes\${APP_PROTOCOL}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${APP_PROTOCOL}\DefaultIcon" "" "$INSTDIR\${PRODUCT_NAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\${APP_PROTOCOL}\shell\open\command" "" '"$INSTDIR\${PRODUCT_NAME}.exe" "%1"'
!macroend

; 安装器侧：旧卸载器失败 → 清理残留后继续安装
;
; $R0 = 旧卸载器退出码（由 handleUninstallResult 传入）。
; 正常升级（$R0 == 0）时本宏不做任何事。
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Old uninstaller exited with code $R0 -- cleaning up and continuing."

    ; 把工作目录移出即将删除的位置（NSIS 要求）
    SetOutPath $TEMP
    ; 尽力删除旧安装目录：新版安装器随后会写入全部文件，个别被占用的稍后被覆盖
    RMDir /r "$INSTDIR"
    ; 不动用户数据（$APPDATA 下的会话库与设置），避免误删

    ; 关键：清掉错误状态，让调用方（installSection.nsh）继续安装新版本
    ClearErrors
  ${endif}
!macroend

; per-machine 安装的对称兜底（本项目默认 CurrentUser；保留以免将来切换时漏掉）
!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend

; 卸载器侧：清理开机自启注册项
;
; 为什么必需（2026-09-21 真机验证）：用户若在应用内
; 开启过开机自启，注册表 HKCU\...\Run 会留下一条指向本应用的启动项；卸载后它仍指向
; 已删除的 exe（系统每次登录尝试启动一个不存在的程序）。
;
; 验证方式（静态检查不可替代真机）：
; - 宏版/对照版探针会给出互相矛盾的结论；正确做法是「不声明任何 Page + SilentInstall silent」实装一次；
; - 卸载器会复制自身到临时目录后异步执行，/S 返回时卸载可能尚未开始——查状态必须轮询，
;   固定 sleep 会落在中间态；
; - 安装器二进制里 grep 不到 NSIS 脚本字符串（压缩），唯一可靠验证 = 装一次 → 查注册表
;   → 卸一次 → 再查。
;
; 约束（与本文件头的三条同源，均经 makensis 编译验证）：
; - 值名 = Electron 写入时用的 `app.getName()`（优先 productName），即 electron-builder.yml
;   的 productName（构建期由 ${PRODUCT_NAME} 提供，卸载器段可用）。
; - 不引用 ${INSTALL_REGISTRY_KEY} / ${UNINSTALL_REGISTRY_KEY}：它们由 multiUser.nsh 定义，
;   而本文件注入在生成的脚本最前面，引用会触发 "unknown variable"（项目把警告当错误）。
; - 只删 Run 键下的这一条值，不动其它键；DeleteRegValue 对不存在的值静默（无需先判断）。
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
  ; 运行时注册的协议键同样归本应用所有；不删会留下指向已卸载 exe 的残留
  DeleteRegKey HKCU "Software\Classes\${APP_PROTOCOL}"
!macroend

; ── 更新模式跳过「安装模式」页（2026-10-01 向导式更新安装）─────────────────
;
; 背景：更新安装由静默（/S）改为向导式（update-service.ts runDeferredInstall 传
; isSilent=false，消除"静默安装全程无窗口"的体验问题）。electron-builder 的
; assistedInstaller.nsh 已为 license/目录页挂了 skipPageIfUpdated（更新时 Abort），
; 但 per-user 安装的「为谁安装」页（multiUserUi.nsh 的 PAGE_INSTALL_MODE）没有——
; 更新时用户会被这页挡住要点一次"下一步"。
;
; 方案：multiUserUi.nsh 的 InstallModePre 在判断 $isForceCurrentInstall 之前留了
; 官方定制口子 `!ifmacrodef customInstallmode`（electron-builder 为"自定义安装
; 模式"设计）——置 1 即走模板自己的 `$isForceCurrentInstall == "1"` 分支：
; setInstallModePerUser + Abort，页面跳过且安装模式被显式收敛为 per-user（比
; PRE 回调里裸 Abort 语义更完整）。
;
; 改后更新向导的实际页面流（--updated 参数下）：
;   [跳过] 安装模式页（本钩子）→ [跳过] 目录页（模板 skipPageIfUpdated）
;   → 安装进度页（到达即自动开始，进度可见）→ 完成页（点「完成」启动新版）
; 手动双击安装器（无 --updated）不受影响，向导完整；手动卸载同理（卸载器的
; InstallModePre 共用本宏，未命中 --updated 时行为不变）。
;
; ⚠️ 为什么不用模板的 ${isUpdated} 宏检测 --updated：它展开为 StdUtils 插件调用，
;    而本文件在 sharedHeader 内部（NsisTarget 的异步任务把 !addplugindir 与本
;    include 并发推入，顺序不定）——实编失败 "Plugin not found"（2026-10-01）。
;    模板自己的 isUpdated 展开点全在 installer.nsi 模板内（必然晚于 addplugindir）
;    所以没事。这里改用 NSIS 标准库 FileFunc.nsh 解析命令行，零插件依赖。
;    electron-updater 固定传 `--updated`（NsisUpdater.doInstall），GetOptions
;    按字面串匹配即可；命中后 Errors 标志清零、未命中 SetErrors——${ifNot}
;    ${Errors} 即"是更新模式"。
;
; ⚠️ 也不要用 MUI_PAGE_CUSTOMFUNCTION_PRE 挂钩：卸载器编译时 MUI_UNPAGE_WELCOME
;    等页面同样消费该 define（MUI2 的 un 页面共用 per-page 定义项），Call 非
;    "un." 前缀函数直接违反 NSIS 卸载器规则（实编失败，2026-10-01）。
!macro customInstallmode
  ${GetOptions} $CMDLINE "--updated" $R0
  ${ifNot} ${Errors}
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend

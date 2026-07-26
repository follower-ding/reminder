# ─── GitHub 一键推送脚本 ─────────────────────────────
# 使用方法: powershell -ExecutionPolicy Bypass .\github-setup.ps1

$REPO = "follower-ding/reminder"
$GITHUB = "https://github.com/$REPO.git"

Write-Host "☀️ 日常提醒系统 — GitHub 推送脚本" -ForegroundColor Cyan
Write-Host ""

# 检查 git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "❌ 请先安装 Git" -ForegroundColor Red
  exit 1
}

# 初始化仓库
if (-not (Test-Path ".git")) {
  git init
  Write-Host "✅ Git 仓库已初始化" -ForegroundColor Green
}

# 添加文件
git add .
Write-Host "✅ 文件已暂存" -ForegroundColor Green

# 提交
$msg = "初始化提醒系统 v3.0"
git commit -m "$msg"
Write-Host "✅ 已提交: $msg" -ForegroundColor Green

# 设置远程仓库
$remote = git remote get-url origin 2>$null
if (-not $remote) {
  git remote add origin $GITHUB
  Write-Host "✅ 远程仓库已添加: $GITHUB" -ForegroundColor Green
}

# 推送到 GitHub
Write-Host "`n⏫ 正在推送到 GitHub ..." -ForegroundColor Yellow
git push -u origin main

Write-Host ""
Write-Host "✅ 推送完成!" -ForegroundColor Green
Write-Host "   仓库: https://github.com/$REPO"
Write-Host "   部署: 登录 Zeabur/Railway/Render 导入此仓库即可"
Write-Host ""
Write-Host "⚠️  注意: config.json 和 data.json 已加入 .gitignore"
Write-Host "   首次部署后请通过 Web 界面配置飞书/Server酱"

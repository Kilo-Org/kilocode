# 克隆你的GitLab项目

git clone http://svn.wesoftcn.com:12080/cfqlilei-git/cfqlilei/kilocode.git
cd <项目目录>

## 添加GitHub原仓库作为远程源，命名为upstream

git remote add upstream https://github.com/Kilo-Org/kilocode.git

## 获取upstream的最新代码

git fetch upstream

## 合并到你的主分支(通常是main或master)

git checkout main
git merge upstream/main

## 推送到GitLab

git push origin main

git push origin 陈凤庆/v4.79.0-feat-新增功能

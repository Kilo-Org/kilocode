# 克隆你的GitLab项目

git clone http://svn.wesoftcn.com:12080/cfqlilei-git/cfqlilei/kilocode.git
cd <项目目录>

## 添加GitHub原仓库作为远程源，命名为upstream

git remote -v
git remote add upstream https://github.com/Kilo-Org/kilocode.git

git remote set-url origin https://github.com/Kilo-Org/kilocode.git
git remote set-url origin http://svn.wesoftcn.com:12080/cfqlilei-git/cfqlilei/kilocode.git

git remote set-url upstream https://github.com/Kilo-Org/kilocode.git
git remote set-url upstream http://svn.wesoftcn.com:12080/cfqlilei-git/cfqlilei/kilocode.git
git push upstream 陈凤庆/v4.79.0-feat-新增功能:陈凤庆/v4.79.0-feat-新增功能

## 获取upstream的最新代码

git fetch upstream
git fetch origin

## 查看远程分支

git branch -r

## 合并到你的主分支(通常是main或master)

git checkout main
git merge upstream/main

## 推送到GitLab

git push origin main

git push origin 陈凤庆/v4.79.0-feat-新增功能
git push origin 待合并/main-20250815

git push upstream main

git push upstream 陈凤庆/v4.79.0-feat-新增功能
git push upstream 待合并/main-20250815

## 合并upstream

git fetch upstream
git checkout main
git rebase upstream/main

为了将来拉取 `upstream` 的最新代码并同步到你的 `origin` 仓库，你可以遵循以下步骤：

1.  **切换到本地 `main` 分支**：
    ```bash
    git checkout main
    ```
2.  **拉取 `upstream` 远程仓库的最新更改**：
    ```bash
    git fetch upstream
    ```
3.  **将本地 `main` 分支与 `upstream/main` 同步**（推荐使用 `rebase` 保持提交历史干净）：
    ```bash
    git rebase upstream/main
    ```
4.  **创建一个新的特性分支**（因为 `origin/main` 有保护，不能直接推送）：
    ```bash
    git checkout -b your-new-sync-branch-name
    ```
5.  **将这个新分支推送到 `origin` 远程仓库**：
    ```bash
    git push origin your-new-sync-branch-name
    ```
6.  **在 `origin` 远程仓库的界面上发起一个合并请求**，将 `your-new-sync-branch-name` 合并到 `main` 分支。

现在，我们回到当前任务。为了将本地 `main` 分支（已经与 `upstream/main` 同步）推送到 `origin`，你需要创建一个新的分支。请告诉我你希望创建的新分支的名称。

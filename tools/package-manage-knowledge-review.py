#!/usr/bin/env python3
"""将异步知识复习及同一提交的共用模块打包到个人技能检出。"""

import argparse
import json
from pathlib import Path
import shutil
import subprocess


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SKILL_NAME = "manage-knowledge-review"
DEPENDENCY_PATHS = (
    "skills/knowledge-base",
    "skills/scenarios/integrate-explained-knowledge",
)


def repository_git(*args):
    return subprocess.check_output(["git", "-C", str(REPOSITORY_ROOT), *args])


def package_manage_knowledge_review(skills_root, ref):
    skills_root = skills_root.resolve()
    remote = subprocess.check_output(
        ["git", "-C", str(skills_root), "remote", "get-url", "origin"], text=True
    ).strip()
    if remote != "https://chatgpt.com/backend-api/git-authed/skills":
        raise ValueError("复习 skill 打包目标必须是个人技能检出")
    destination = skills_root / SKILL_NAME
    if not (destination / "SKILL.md").is_file():
        raise ValueError("先用 skill-creator 在个人技能检出中初始化 manage-knowledge-review")

    revision = repository_git("rev-parse", "--verify", f"{ref}^{{commit}}").decode().strip()
    paths = repository_git(
        "ls-tree", "-r", "--name-only", revision, "--", *DEPENDENCY_PATHS
    ).decode().splitlines()
    for dependency in DEPENDENCY_PATHS:
        if f"{dependency}/SKILL.md" not in paths:
            raise ValueError(f"复习 skill 打包缺少共用模块：{dependency}")

    # 规则与实现按原路径完整分发；仓库原模块仍是唯一维护入口。
    modules = destination / "modules"
    if modules.exists():
        raise ValueError("复习 skill 已有 modules；请核对现有安装包后再更新")
    source = REPOSITORY_ROOT / "skills" / "scenarios" / SKILL_NAME
    shutil.copytree(source, destination, dirs_exist_ok=True)
    for relative in paths:
        target = modules / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(repository_git("show", f"{revision}:{relative}"))
    (modules / "source.json").write_text(
        json.dumps(
            {
                "repository": "JiaJunDeng5930/knowledge-base",
                "revision": revision,
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"复习 skill 打包完成：{destination}（{len(paths)} 个依赖文件，提交 {revision}）")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skills-root", type=Path, default=Path("/root/.codex/skills/remote-skills")
    )
    parser.add_argument("--ref", default="HEAD", help="共用模块所用的本仓库提交")
    args = parser.parse_args()
    package_manage_knowledge_review(args.skills_root, args.ref)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Initial clustering and candidate identification for Kilocode audit."""
import json
import re
from collections import defaultdict
from math import log
from pathlib import Path

ROOT = Path(__file__).parent


def load():
    issues = json.load(open(ROOT / "issues_raw.json"))
    prs = json.load(open(ROOT / "prs_body_files.json"))
    return issues, prs


def normalize(text):
    if not text:
        return ""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\b(https?|github|com|issue|pr|pull|fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\b", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tokens(text):
    return normalize(text).split()


def df(docs):
    counts = defaultdict(int)
    for doc in docs:
        seen = set(tokens(doc))
        for t in seen:
            counts[t] += 1
    return counts


def tfidf_vector(doc, idf):
    vec = defaultdict(float)
    for t in tokens(doc):
        vec[t] += idf.get(t, 0)
    return vec


def cosine(a, b):
    if not a or not b:
        return 0.0
    dot = sum(a[t] * b.get(t, 0) for t in a)
    norm_a = sum(v * v for v in a.values()) ** 0.5
    norm_b = sum(v * v for v in b.values()) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def issue_text(issue):
    return issue["title"] + " " + (issue.get("body") or "")


def pr_text(pr):
    return pr["title"] + " " + (pr.get("body") or "")


def extract_refs(text):
    if not text:
        return []
    refs = set()
    for m in re.finditer(r"#(\d+)", text):
        refs.add(int(m.group(1)))
    for m in re.finditer(r"(?:fixes|closes|closed|fix|close|resolve|resolves|resolved)[\s:#]*(\d+)", text, re.I):
        refs.add(int(m.group(1)))
    return sorted(refs)


def find_duplicate_issues(issues, threshold=0.55, top_n=200):
    docs = [issue_text(i) for i in issues]
    N = len(docs)
    idf_vals = {t: log(N / (c + 1)) for t, c in df(docs).items()}
    vectors = [tfidf_vector(d, idf_vals) for d in docs]
    pairs = []
    for i in range(N):
        for j in range(i + 1, N):
            sim = cosine(vectors[i], vectors[j])
            if sim >= threshold:
                pairs.append((sim, i, j))
    pairs.sort(reverse=True)
    return pairs[:top_n]


def find_pr_issue_links(prs, issues):
    issue_map = {i["number"]: i for i in issues}
    results = []
    for pr in prs:
        refs = set(extract_refs(pr_text(pr)))
        explicit_closing = {r["number"] for r in pr.get("closingIssuesReferences", [])}
        unlinked = refs - explicit_closing
        linked_issues = [issue_map[n] for n in unlinked if n in issue_map]
        if linked_issues:
            results.append({"pr": pr, "refs": sorted(unlinked), "issues": linked_issues})
    return results


def find_pr_file_overlap(prs, min_overlap=3, min_ratio=0.5):
    pr_files = []
    for pr in prs:
        paths = [f["path"] for f in pr.get("files", [])]
        pr_files.append((pr, set(paths)))
    pairs = []
    for i in range(len(pr_files)):
        for j in range(i + 1, len(pr_files)):
            p1, f1 = pr_files[i]
            p2, f2 = pr_files[j]
            inter = f1 & f2
            if not inter:
                continue
            union = f1 | f2
            jaccard = len(inter) / len(union) if union else 0
            if len(inter) >= min_overlap and jaccard >= min_ratio:
                pairs.append((jaccard, len(inter), p1["number"], p2["number"], p1, p2, inter))
    pairs.sort(key=lambda x: (x[0], x[1], x[2], x[3]), reverse=True)
    return pairs


def label_set(item):
    return {l["name"] for l in item.get("labels", [])}


def main():
    issues, prs = load()
    print(f"Loaded {len(issues)} issues, {len(prs)} PRs")

    # 1. Duplicate issue candidates
    dup_pairs = find_duplicate_issues(issues, threshold=0.50, top_n=300)
    dup_out = []
    for sim, i, j in dup_pairs:
        li, lj = label_set(issues[i]), label_set(issues[j])
        dup_out.append({
            "sim": round(sim, 3),
            "a": {"number": issues[i]["number"], "title": issues[i]["title"], "url": issues[i]["url"], "labels": sorted(li)},
            "b": {"number": issues[j]["number"], "title": issues[j]["title"], "url": issues[j]["url"], "labels": sorted(lj)},
            "shared_labels": sorted(li & lj),
        })
    (ROOT / "candidate_duplicates.json").write_text(json.dumps(dup_out, indent=2))
    print(f"Wrote {len(dup_out)} duplicate candidates")

    # 2. PRs with explicit issue refs but not linked
    link_candidates = find_pr_issue_links(prs, issues)
    link_out = []
    for row in link_candidates:
        link_out.append({
            "pr_number": row["pr"]["number"],
            "pr_title": row["pr"]["title"],
            "pr_url": row["pr"]["url"],
            "referenced_issues": [
                {"number": i["number"], "title": i["title"], "url": i["url"]} for i in row["issues"]
            ],
        })
    (ROOT / "candidate_pr_issue_links.json").write_text(json.dumps(link_out, indent=2))
    print(f"Wrote {len(link_out)} PR->issue link candidates")

    # 3. PRs without any closing issue reference
    no_issue_prs = []
    for pr in prs:
        explicit = pr.get("closingIssuesReferences", [])
        refs = extract_refs(pr_text(pr))
        if not explicit and not refs:
            no_issue_prs.append({
                "number": pr["number"],
                "title": pr["title"],
                "url": pr["url"],
                "changedFiles": len(pr.get("files", [])),
                "body_preview": (pr.get("body") or "")[:300],
            })
    (ROOT / "candidate_prs_without_issues.json").write_text(json.dumps(no_issue_prs, indent=2))
    print(f"Wrote {len(no_issue_prs)} PRs without issue references")

    # 4. Duplicate/competing PR candidates
    overlap = find_pr_file_overlap(prs, min_overlap=3, min_ratio=0.35)
    overlap_out = []
    for jaccard, count, _, _, p1, p2, files in overlap:
        overlap_out.append({
            "jaccard": round(jaccard, 3),
            "shared_files_count": count,
            "a": {"number": p1["number"], "title": p1["title"], "url": p1["url"]},
            "b": {"number": p2["number"], "title": p2["title"], "url": p2["url"]},
            "shared_files": sorted(files)[:30],
        })
    (ROOT / "candidate_pr_duplicates.json").write_text(json.dumps(overlap_out, indent=2))
    print(f"Wrote {len(overlap_out)} duplicate/competing PR candidates")


if __name__ == "__main__":
    main()

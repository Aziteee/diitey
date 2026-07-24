import type { ContentRecord } from "diitey";

export function postTags(post: ContentRecord): readonly string[] {
  const tags = post.attributes.tags;
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags.filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
  );
}

export function tagSectionId(tag: string): string {
  return `tag-${encodeURIComponent(tag)}`;
}

export function tagHref(tag: string): string {
  return `/tags#${tagSectionId(tag)}`;
}

export function groupPostsByTag(
  posts: readonly ContentRecord[],
): readonly {
  readonly tag: string;
  readonly posts: readonly ContentRecord[];
}[] {
  const groups = new Map<string, ContentRecord[]>();
  for (const post of posts) {
    for (const tag of postTags(post)) {
      const bucket = groups.get(tag);
      if (bucket) {
        bucket.push(post);
      } else {
        groups.set(tag, [post]);
      }
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([tag, tagPosts]) => ({ tag, posts: tagPosts }));
}

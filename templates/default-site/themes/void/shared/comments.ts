export interface CommentReplyTo {
  readonly id: number;
  readonly authorName: string;
}

export interface CommentNode {
  readonly id: number;
  readonly contentId: string;
  readonly parentId: number | null;
  readonly replyTo: CommentReplyTo | null;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface CommentTreeNode extends CommentNode {
  readonly replies: readonly CommentNode[];
}

(function exposeCommunityPostCard(global) {
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[char];
    });
  }

  function renderPostCard(post, options = {}) {
    const previewMode = options.preview === true;
    const previewClass = previewMode ? " feed-card-preview" : "";
    const isEditing = options.isEditing === true;
    const commentsOpen = options.commentsOpen === true;
    const commentPanelId = `comment-panel-${post.id}`;
    const commentToggleLabel = commentsOpen
      ? `收起《${post.title}》的评论`
      : `展开《${post.title}》的评论`;
    const managementActions =
      post.canManage && !previewMode
        ? `
          <div class="post-management" aria-label="帖子管理">
            <button class="post-action" type="button" data-post-edit="${post.id}">修改</button>
            <button class="post-action is-danger" type="button" data-post-delete="${post.id}">删除</button>
          </div>
        `
        : "";
    const postContent = isEditing
      ? `
        <form class="post-edit-form" data-post-edit-form="${post.id}" novalidate>
          <label>
            <span>标题</span>
            <input name="title" type="text" maxlength="${options.titleMaxLength}" value="${escapeHtml(post.title)}" required />
          </label>
          <label>
            <span>内容</span>
            <textarea name="body" maxlength="${options.bodyMaxLength}" required>${escapeHtml(post.body)}</textarea>
          </label>
          <p class="post-edit-message" data-post-edit-message aria-live="polite"></p>
          <div class="post-edit-actions">
            <button class="post-action" type="button" data-post-edit-cancel="${post.id}">取消</button>
            <button class="primary-btn post-save" type="submit">保存修改</button>
          </div>
        </form>
      `
      : `
        <h3>${escapeHtml(post.title)}</h3>
        <p class="feed-body">${escapeHtml(options.displayBody)}</p>
      `;

    return `
      <article class="feed-card${previewClass}" data-post-id="${post.id}">
        <div class="feed-card-head">
          <div class="feed-meta"><span>${escapeHtml(options.author)}</span><span>${escapeHtml(options.time)}</span></div>
          ${managementActions}
        </div>
        ${postContent}
        <div class="comment-box ${commentsOpen ? "is-open" : ""}" ${isEditing ? "hidden" : ""}>
          <div class="comment-toolbar">
            <button
              class="comment-toggle"
              type="button"
              data-comment-toggle="${post.id}"
              aria-expanded="${String(commentsOpen)}"
              aria-controls="${escapeHtml(commentPanelId)}"
              aria-label="${escapeHtml(commentToggleLabel)}"
            >评论</button>
            <span class="comment-count">评论 ${options.commentCount}</span>
          </div>
          <div class="comment-panel" id="${escapeHtml(commentPanelId)}">
            <div class="comment-form">
              <input
                class="comment-input"
                type="text"
                placeholder="写下你的观察或想法..."
                aria-label="写下你的观察或想法"
                aria-invalid="false"
                data-comment-input="${post.id}"
              />
              <button class="comment-send" type="button" data-comment-submit="${post.id}">发送</button>
            </div>
            <ul class="comment-list">${options.commentsHtml}</ul>
          </div>
        </div>
      </article>
    `;
  }

  global.BirdoraCommunityPostCard = { renderPostCard };
})(window);

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
    const canInteract = options.canInteract !== false;
    const commentsOpen = options.commentsOpen === true;
    const commentPanelId = `comment-panel-${post.id}`;
    const feedback = options.feedback || {};
    const helpful = feedback.helpful || { count: 0, selected: false };
    const curious = feedback.curious || { count: 0, selected: false };
    const analysis = options.analysis || {};
    const analysisTags = Array.isArray(analysis.tags) ? analysis.tags : [];
    const analysisSuggestions = Array.isArray(analysis.suggestions) ? analysis.suggestions : [];
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
    const postImage = post.imageUrl
      ? `
        <figure class="post-image-frame">
          <img src="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.imageAlt || post.title)}" loading="lazy" />
        </figure>
      `
      : "";
    const analysisBlock =
      analysis.summary && !isEditing
        ? `
          <section class="post-analysis" aria-label="文案分析">
            <div class="post-analysis-head">
              <span>文案分析</span>
              <strong>${escapeHtml(String(analysis.score || 0))}</strong>
            </div>
            <p>${escapeHtml(analysis.summary)}</p>
            ${
              analysisTags.length
                ? `<div class="analysis-tags">${analysisTags
                    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
                    .join("")}</div>`
                : ""
            }
            ${
              analysisSuggestions.length
                ? `<ul>${analysisSuggestions
                    .map((suggestion) => `<li>${escapeHtml(suggestion)}</li>`)
                    .join("")}</ul>`
                : ""
            }
          </section>
        `
        : "";
    const engagementActions =
      canInteract && !isEditing
        ? `
          <div class="engagement-bar" aria-label="帖子评价">
            <button class="feedback-action ${helpful.selected ? "is-selected" : ""}" type="button" data-post-reaction="${post.id}" data-reaction-type="helpful" aria-pressed="${String(helpful.selected)}">有帮助 ${helpful.count}</button>
            <button class="feedback-action ${curious.selected ? "is-selected" : ""}" type="button" data-post-reaction="${post.id}" data-reaction-type="curious" aria-pressed="${String(curious.selected)}">想了解 ${curious.count}</button>
          </div>
        `
        : "";
    const interactionForms =
      canInteract && !isEditing
        ? `
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
          <div class="question-form">
            <input
              class="comment-input"
              type="text"
              placeholder="向发布者提问..."
              aria-label="向发布者提问"
              aria-invalid="false"
              data-question-input="${post.id}"
            />
            <button class="comment-send" type="button" data-question-submit="${post.id}">提问</button>
          </div>
        `
        : "";

    return `
      <article class="feed-card${previewClass}" data-post-id="${post.id}">
        <div class="feed-card-head">
          <div class="feed-meta"><span>${escapeHtml(options.author)}</span><span>${escapeHtml(options.time)}</span></div>
          ${managementActions}
        </div>
        ${postImage}
        ${postContent}
        ${analysisBlock}
        ${engagementActions}
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
            <span class="comment-count">提问 ${options.questionCount}</span>
          </div>
          <div class="comment-panel" id="${escapeHtml(commentPanelId)}">
            ${interactionForms}
            <ul class="comment-list">${options.commentsHtml}</ul>
            <ul class="question-list">${options.questionsHtml}</ul>
          </div>
        </div>
      </article>
    `;
  }

  global.BirdoraCommunityPostCard = { renderPostCard };
})(window);

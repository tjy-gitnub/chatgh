class ContentProcessor {
    constructor() {
        // 初始化 marked
        marked.setOptions({
            breaks: false,
            highlight: function(code, lang) {
                return code;
            }
        });

        // 设置 marked 的自定义渲染器
        const renderer = new marked.Renderer();
        renderer.code = (code) => {
            const language=code.lang;
            if (language === 'mermaid' || language === 'svg') {
                // 保护特殊代码块不被 markdown 处理
                return `<protected-block type="${language}">${this.escapeHtml(code.text)}</protected-block>`;
            }
            return `<pre><code class="language-${language}">${this.escapeHtml(code.text)}</code></pre>`;
        };
        marked.use({ renderer });
    }

    async process(content) {
        try {
            // 确保输入是字符串
            content = String(content || '');

            // 1. 处理 think 内容
            content = this.processThinkContent(content);
            
            // 2. Markdown 渲染，此时特殊代码块被保护
            content = marked.parse(content);

            // 3. 处理被保护的代码块
            content = await this.processProtectedBlocks(content);

            return content;
        } catch (err) {
            console.error('内容处理失败:', err);
            return `<div class="error">内容处理失败: ${err.message}</div>`;
        }
    }

    processThinkContent(content) {
        if (!content) return '';
        return content.replace(/<think>([\s\S]*?)<\/think>|<think>([\s\S]*?)$/g, 
            (match, closed, open) => {
                const thinkContent = closed || open || '';
                return `<div class="think-content ${closed ? 'collapsed' : 'thinking'}">
                    <div class="think-header">
                        <span class="think-title">深度思考</span>
                        <button class="think-toggle">
                            <i class="bi bi-chevron-${closed ? 'down' : 'up'}"></i>
                        </button>
                    </div>
                    <div class="think-body">${thinkContent}</div>
                </div>`;
            }
        );
    }

    async processProtectedBlocks(content) {
        const regex = /<protected-block type="(.*?)">([\s\S]*?)<\/protected-block>/g;
        let match;
        let processedContent = content;

        while ((match = regex.exec(content)) !== null) {
            const [fullMatch, type, code] = match;
            const decodedCode = this.unescapeHtml(code);
            let replacement = '';

            try {
                if (type === 'mermaid') {
                    const {svg} = await this.renderMermaid(decodedCode);
                    replacement = this.wrapInPreview('Mermaid', decodedCode, svg);
                } else if (type === 'svg') {
                    replacement = this.wrapInPreview('SVG', decodedCode, decodedCode);
                }
            } catch (err) {
                console.error(`${type} 渲染失败:`, err);
                replacement = this.wrapInPreview(
                    `${type} (渲染失败)`, 
                    decodedCode, 
                    `<div class="error">渲染失败: ${err.message}</div>`
                );
            }

            processedContent = processedContent.replace(fullMatch, replacement);
        }

        return processedContent;
    }

    async renderMermaid(code) {
        if (!code) throw new Error('空的 Mermaid 代码');
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return await mermaid.render(id, code);
    }

    wrapInPreview(title, code, rendered) {
        return `
            <div class="preview-container">
                <div class="preview-header">
                    <span class="preview-title">${title}</span>
                    <button class="preview-toggle">查看代码</button>
                </div>
                <div class="preview-content">
                    <pre><code class="language-${title.toLowerCase()}">${this.escapeHtml(String(code))}</code></pre>
                    <div class="rendered ${title.toLowerCase()}-container">${rendered}</div>
                </div>
            </div>
        `;
    }

    escapeHtml(str) {
        if (typeof str !== 'string') {
            console.warn('escapeHtml: 输入不是字符串:', str);
            str = String(str || '');
        }
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    unescapeHtml(str) {
        if (typeof str !== 'string') {
            console.warn('unescapeHtml: 输入不是字符串:', str);
            str = String(str || '');
        }
        return str
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, "\"")
            .replace(/&#039;/g, "'");
    }
}

class ChatManager {
    constructor() {
        this.chatHistory = [];
        this.isProcessing = false;
        this.editingMessageId = null;
        
        // 从localStorage同步模型设置
        this.defaultModel = "deepseek/DeepSeek-R1";
        this.currentModel = localStorage.getItem('defaultModel') || this.defaultModel;
        if(GITHUB_TOKEN!='__your_gh_token__'){
            this.ghtoken=GITHUB_TOKEN;
            $('#sidebar>.token').hide();
        }
        // 从localStorage恢复群聊状态
        const savedMode = localStorage.getItem('groupMode');
        if (savedMode === 'true') {
            this.groupMode = true;
            const savedAssistants = localStorage.getItem('groupAssistants');
            const savedModels = localStorage.getItem('memberModels');
            if (savedAssistants) {
                this.assistants = JSON.parse(savedAssistants);
            }
            if (savedModels) {
                this.memberModels = new Map(JSON.parse(savedModels));
            }
            console.log('Restored group chat state:', {
                mode: this.groupMode,
                assistants: this.assistants,
                models: this.memberModels
            });
        }

        this.setupEventListeners();
        this.loadHistory();
        this.nextAtIgnored = false; // 添加标志位
        // 自定义渲染器
        // const renderer = new marked.Renderer();

        // // 自定义处理段落
        // renderer.paragraph = (text) => {
        //     // console.log(text);
        // text=text.raw;
        // // 检测并处理行间公式（$$...$$）
        // if (text.startsWith("$$") && text.endsWith("$$")) {
        //     const formula = text.slice(2, -2).trim();
        //     return `<p>${katex.renderToString(formula, { displayMode: true })}</p>`;
        // }

        // // 检测并处理行内公式（$...$）
        // const inlineFormulaRegex = /\$(.+?)\$/g;
        // if (inlineFormulaRegex.test(text)) {
        //     text = text.replace(inlineFormulaRegex, (match, formula) => {
        //     return katex.renderToString(formula, { displayMode: false });
        //     });
        // }

        // return `<p>${text}</p>`;
        // };
        // 初始化 markdown
        marked.setOptions({
            // renderer,
            breaks: false,
            // gfm: false,
            highlight: function(code, lang) {
                return code;
            },
        });

        this.setupAutoResize();
        this.initKaTeX();

        // 添加群聊相关属性
        this.groupMode = false;
        this.assistants = [];
        this.currentResponder = null;
        
        // 添加群聊成员的模型配置
        this.memberModels = new Map();
        
        this.setupGroupChat();

        // 初始化 Mermaid
        mermaid.initialize({
            startOnLoad: false,
            theme: 'default'
        });

        this.contentProcessor = new ContentProcessor();
    }

    // 设置输入框自动调整高度
    setupAutoResize() {
        const textarea = $('#message-input')[0];
        const setHeight = () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
            $('#chat-messages').css('padding-bottom',textarea.scrollHeight);
        };
        
        $('#message-input').on('input', setHeight);
    }

    // 初始化KaTeX
    initKaTeX() {
        renderMathInElement(document.body, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                // {left: '[', right: ']', display: true},
                // {left: '( ', right: ' )', display: false},
                {left: '$', right: '$', display: false},
            ],
            throwOnError: false,
        });
    }

    addMessage(content, isUser, sender = null) {
        const message = this.createMessage(content, isUser, sender);
        this.chatHistory.push(message);
        const $messageElement = this.renderMessage(message);
        $('#chat-messages').append($messageElement);
        this.scrollToBottom();
        this.saveHistory();
        return message;
    }

    // DOM 元素获取
    get elements() {
        return {
            messagesContainer: document.getElementById('chat-messages'),
            messageInput: document.getElementById('message-input'),
            sendButton: document.getElementById('send-button'),
            modelSelector: document.getElementById('model-selector')
        };
    }

    // 更新事件监听
    setupEventListeners() {
        $('#send-button').click(() => this.handleSendMessage());
        $('#message-input').on('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        $('#theme-toggle').click(() => this.toggleTheme());

        // 命令处理
        $('#message-input').on('input', () => this.handleCommandInput());

        // 加载模型列表
        this.loadModels();

        // 添加打断按钮事件
        $('#interrupt-button').click(() => {
            this.nextAtIgnored = true;
            $('#interrupt-button').hide();
            this.currentResponder = null;
        });
    }

    // 消息类
    createMessage(content, isUser, id = Date.now(), sender = null) {
        return {
            id: Date.now() + Math.random().toString(36).substr(2, 9), // 生成更唯一的ID
            content,
            isUser,
            sender,
            role: isUser ? 'user' : (sender || 'assistant'), // 记录具体的assistant角色
            displayName: this.getDisplayName(sender), // 添加显示名称
            timestamp: new Date().toISOString(),
            edited: false,
            model: !isUser ? (this.currentModel || this.defaultModel) : null // 记录使用的模型
        };
    }

    // 添加新方法：获取显示名称
    getDisplayName(sender) {
        if (!sender) return 'AI';
        if (sender === 'user') return '用户';
        if (sender.startsWith('assistant')) {
            return `助手${sender.slice(9)}`;
        }
        return sender;
    }

    // 消息发送处理
    async handleSendMessage() {
        const { messageInput } = this.elements;
        const content = messageInput.value;
        
        if (!content || this.isProcessing) return;

        // 命令处理
        if (content.startsWith('/')) {
            this.handleCommand(content);
            messageInput.value = '';
            return;
        }

        if (this.groupMode) {
            console.log('Current state:', {
                nextAtIgnored: this.nextAtIgnored,
                currentResponder: this.currentResponder
            });

            if (!this.nextAtIgnored && !this.currentResponder) {
                const matches = content.match(/@(assistant\d+)/);
                if (!matches) {
                    this.showError('请使用@指定一个AI助手回答');
                    return;
                }
                
                if (matches[1].startsWith('assistant')) {
                    const responderIndex = parseInt(matches[1].slice(9)) - 1;
                    if (!this.assistants.includes(responderIndex)) {
                        this.showError('指定的AI助手不在群聊中');
                        return;
                    }
                    this.currentModel = this.memberModels.get(responderIndex) || this.defaultModel;
                    this.currentResponder = matches[1];
                } else {
                    // 如果没有指定助手，使用在群组中的第一个助手
                    this.currentResponder = `assistant${this.assistants[0] + 1}`;
                    this.currentModel = this.memberModels.get(this.assistants[0]) || this.defaultModel;
                }
                console.log('Set responder from @:', this.currentResponder);
            }
        }

        // 添加用户消息
        const userMessage = this.addMessage(content, true, 'user');
        messageInput.value = '';
        
        await this.sendToServer(userMessage);
    }

    // 服务器通信
    // 在 ChatManager 类中修改消息处理相关方法

async sendToServer(userMessage) {
    this.setLoading(true);
    let fullResponse = '';
    let buffer = '';

    try {
        // 准备消息历史，不包含临时的触发消息
        const messageHistory = this.chatHistory.slice();

        // 如果是自动触发的对话，添加一个临时的空白用户消息
        if (userMessage.content.startsWith('[info:')) {
            console.log('Adding temporary trigger message');
            messageHistory.push(userMessage);
        }
        // {
        // }

        // 获取当前响应者的编号
        const responderNum = this.currentResponder ? 
            this.currentResponder.match(/\d+$/) : null;
        
        // 构建系统提示
        let systemPrompt;
        if(typeof systemp == 'string'){
            systemPrompt=systemp;
        }else{
            systemPrompt = this.groupMode ? 
                GROUP_CHAT_CONFIG.systemPrompt
                    .replace('{participants}', [
                        'user',
                        ...this.assistants.map(i => `assistant${i + 1}`)
                    ].join('、'))
                    .replace('{name}', `assistant${responderNum || ''}`)
                : "用中文回答。使用标准的Markdown格式。";
        }

        console.log('System prompt:', systemPrompt);

        const messages = [
            { role: "system", content: systemPrompt },
            ...messageHistory.map(msg => ({
                role: msg.role, // 使用存储的具体角色
                content: msg.content,
                name: msg.sender
            }))
        ];

        const headers = new Headers();
        headers.append('Content-Type', 'application/json');
        headers.append('Authorization', `Bearer ${this.ghtoken}`);

        console.log(messages);

        const response = await fetch(`${ENDPOINT}/chat/completions`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                messages: messages,
                model: this.currentModel || this.defaultModel,
                temperature: 0.7,
                stream: true
            })
        });
        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('达到请求限制，尝试换一个模型重试，或一分钟/一天后再试。');
            }
            throw new Error(`请求失败: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        let streamingMessageAdded = false;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            // 改进数据处理
            buffer += new TextDecoder().decode(value);
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保存不完整的行

            for (const line of lines) {
                if (line.trim() === 'data: [DONE]') {
                    continue; // 跳过 [DONE] 消息
                }
                if (line.trim() && line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(5));
                        if (data.error) {
                            throw new Error(data.error);
                        }
                        
                        const content = data.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullResponse += content;
                            if (!streamingMessageAdded) {
                                this.updateStreamingMessage(fullResponse);
                                streamingMessageAdded = true;
                            } else {
                                this.updateStreamingMessage(fullResponse);
                            }
                        }
                    } catch (parseError) {
                        console.warn('跳过无效数据:', line);
                        continue;
                    }
                }
            }
        }

        // 处理缓冲区中剩余的数据
        if (buffer.trim()) {
            try {
                const data = JSON.parse(buffer.slice(5));
                const content = data.choices?.[0]?.delta?.content || '';
                if (content) {
                    fullResponse += content;
                    this.updateStreamingMessage(fullResponse);
                }
            } catch (e) {
                console.error('处理最后的缓冲区数据失败:', e);
            }
        }

        if (fullResponse) {
            this.finalizeMessage(fullResponse);
        }

    } catch (error) {
        console.error('请求失败:', error);
        this.showError(error.message || '服务器连接失败，请稍后重试');
    } finally {
        this.setLoading(false);
    }
}

async updateStreamingMessage(content) {
    console.log('更新流式消息:', content);
    let $messageDiv = $('.message.bot.streaming');
    
    if ($messageDiv.length === 0) {
        // 创建消息时就添加发送者信息
        const modelName = this.currentResponder ? 
            AVAILABLE_MODELS[this.memberModels.get(parseInt(this.currentResponder.slice(9)) - 1)] || 'Unknown' : 
            AVAILABLE_MODELS[this.currentModel] || 'Unknown';
        
        const displayName = this.currentResponder ? 
            `助手${parseInt(this.currentResponder.slice(9))}` : 'AI';

        $messageDiv = $('<div>')
            .addClass('message bot streaming')
            .attr('data-role', this.currentResponder || 'assistant');

        // 添加头部信息
        $messageDiv.append(
            $('<div>').addClass('message-info-header').append(
                $('<span>').addClass('sender-name').text(displayName),
                $('<span>').addClass('ai-model').text(`[${modelName}]`)
            )
        );

        $messageDiv.append($('<div>').addClass('message-content'))
            .append('<loading><svg width="16px" height="16px" viewBox="0 0 16 16"><circle cx="8px" cy="8px" r="6px"></circle></svg></loading>');
            
        $('#chat-messages').append($messageDiv);
    }

    // 处理内容
    try {
        const processedContent = await this.contentProcessor.process(content);
        const $content = $messageDiv.find('.message-content');
        
        // 更新内容
        $content.html(processedContent);
        
        // 渲染数学公式
        this.renderMath($content[0]);
        
        // 高亮代码
        this.highlightCode($content);
        
        // 平滑展开效果
        const currentHeight = $content[0].scrollHeight;
        $content.css('max-height', (currentHeight + 50) + 'px');
        
        this.scrollToBottom();
    } catch (err) {
        console.error('处理消息内容失败:', err);
        const $content = $messageDiv.find('.message-content');
        $content.html(`<div class="error">渲染失败: ${err.message}</div>`);
    }
}

// 修改finalizeMessage方法
finalizeMessage(content) {
    const $streamingMessage = $('.message.bot.streaming');
    if ($streamingMessage.length) {
        // 移除流式状态和loading图标
        $streamingMessage
            .removeClass('streaming')
            .find('loading')
            .remove();
        
        const $content = $streamingMessage.find('.message-content');
        $content.css('max-height', 'none');
        
        // 创建消息时添加发送者
        const message = this.createMessage(content, false, this.currentResponder);
        this.chatHistory.push(message);
        
        // 处理AI回答中的@并触发下一轮对话
        if (this.groupMode && !this.nextAtIgnored) {
            const atMatch = content.match(/@(assistant\d+|user)/);
            console.log('Found @ in message:', atMatch);
            if (atMatch) {
                const pras=this.currentResponder;
                this.currentResponder = atMatch[1];
                $('#interrupt-button').show();
                console.log('Set next responder to:', this.currentResponder);

                // 如果下一个回应者是AI，自动触发对话
                if (this.currentResponder.startsWith('assistant')) {
                    const responderIndex = parseInt(this.currentResponder.slice(9)) - 1;
                    if (this.assistants.includes(responderIndex)) {
                        console.log('Auto triggering next response for:', this.currentResponder);
                        this.currentModel = this.memberModels.get(responderIndex) || this.defaultModel;
                        
                        const prevDisplayName = this.getDisplayName(pras);
                        this.sendToServer({
                            content: `[info: ${prevDisplayName}提及了你]`,
                            isUser: true,
                            sender: 'user',
                            role:'user',
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            } else {
                this.currentResponder = null;
                $('#interrupt-button').hide();
            }
        } else {
            $('#interrupt-button').hide();
        }
        
        this.nextAtIgnored = false;
        
        const $actions = this.createMessageActions(message);
        $streamingMessage.append($actions);
        this.saveHistory();
    }
}

showError(message) {
    const $errorDiv = $('<div>')
        .addClass('message bot error')
        .append(
            $('<div>')
                .addClass('message-content error')
                .text(`错误: ${message}`)
        );
    
    $('#chat-messages').append($errorDiv);
    this.scrollToBottom();
}

// 修改 renderMessage 方法
async renderMessage(message) {
    const $messageDiv = $('<div>')
        .addClass(`message ${message.isUser ? 'user' : 'bot'}`)
        .attr('data-id', message.id)
        .attr('data-role', message.role); // 添加role属性用于标识

    // 添加AI消息的发送者信息
    if (!message.isUser) {
        const modelName = message.sender ? 
            AVAILABLE_MODELS[this.memberModels.get(parseInt(message.sender.slice(9)) - 1)] || 'Unknown' : 
            AVAILABLE_MODELS[message.model] || 'Unknown';
        
        const displayName = message.displayName || this.getDisplayName(message.sender);
            
        $messageDiv.prepend(
            $('<div>').addClass('message-info-header').append(
                $('<span>').addClass('sender-name').text(displayName),
                $('<span>').addClass('ai-model').text(`[${modelName}]`)
            )
        );
    }

    const $content = $('<div>').addClass('message-content');
    
    if (!message.isUser) {
        let content = message.content;
        content = this.processThinkContent(content);
        content = this.processSVGContent(content);
        
        try {
            content = await this.processMermaidContent(content);
            $content.html(marked.parse(content));
            
            // 渲染数学公式
            renderMathInElement($content[0], {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\[', right: '\\]', display: true},
                    {left: '\\(', right: '\\)', display: false}
                ],
                throwOnError: false
            });
            
            // 高亮代码
            $content.find('pre code').each((i, block) => {
                Prism.highlightElement(block);
            });
        } catch (err) {
            console.error('Mermaid 渲染失败:', err);
            $content.html(marked.parse(content));
        }
    } else {
        $content.text(message.content);
    }

    const $actions = this.createMessageActions(message);
    const $info = this.createMessageInfo(message);

    $messageDiv.append($content, $actions, $info);
    return $messageDiv;
}

// 处理think内容
// 修改processThinkContent方法
processThinkContent(content) {
    return content.replace(/<think>([\s\S]*?)<\/think>|<think>([\s\S]*?)$/g, 
        (match, closed, open) => {
            const thinkContent = closed || open;
            return `<div class="think-content ${closed ? 'collapsed' : 'thinking'}">
                <div class="think-header">
                    <span class="think-title">深度思考</span>
                    <button class="think-toggle">
                        <i class="bi bi-chevron-${closed ? 'down' : 'up'}"></i>
                    </button>
                </div>
                <div class="think-body">${thinkContent}</div>
            </div>`;
        }
    );
}

// 添加 SVG 处理方法
processSVGContent(content) {
    return content.replace(/```svg\n([\s\S]*?)```/g, (match, code) => {
        return `<div class="preview-container">
            <div class="preview-header">
                <span class="preview-title">SVG</span>
                <button class="preview-toggle">查看代码</button>
            </div>
            <div class="preview-content">
                <pre><code class="language-svg">${this.escapeHtml(code)}</code></pre>
                <div class="rendered svg-container">${code}</div>
            </div>
        </div>`;
    });
}

// 修改 processMermaidContent 方法
async processMermaidContent(content) {
    const matches = content.match(/```mermaid\n([\s\S]*?)```/g);
    if (!matches) return content;

    for (const match of matches) {
        const code = match.replace(/```mermaid\n/, '').replace(/```$/, '').trim();
        try {
            const {svg} = await mermaid.render(`mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, code);
            content = content.replace(match, `<div class="preview-container">
                <div class="preview-header">
                    <span class="preview-title">Mermaid</span>
                    <button class="preview-toggle">查看代码</button>
                </div>
                <div class="preview-content">
                    <pre><code class="language-mermaid">${this.escapeHtml(code)}</code></pre>
                    <div class="rendered mermaid-container">${svg}</div>
                </div>
            </div>`);
        } catch (err) {
            console.error('Mermaid 渲染失败:', err);
            content = content.replace(match, `<div class="preview-container">
                <div class="preview-header">
                    <span class="preview-title">Mermaid (渲染失败)</span>
                </div>
                <div class="preview-content">
                    <pre><code class="language-mermaid">${this.escapeHtml(code)}</code></pre>
                    <div class="rendered mermaid-container error">渲染失败: ${err.message}</div>
                </div>
            </div>`);
        }
    }
    return content;
}

// 添加 HTML 转义方法
escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 修复消息操作按钮
createMessageActions(message) {
    const $actionsDiv = $('<div>').addClass('message-actions');
    
    const actions = [
        { text: '编辑', onClick: () => this.startEditing(message.id) },
        { text: '删除', onClick: () => this.deleteMessage(message.id) }
    ];
    
    if (message.isUser) {
        actions.push({ text: '重新回答', onClick: () => this.retryMessage(message.id) });
    }

    actions.forEach(action => {
        $('<button>')
            .addClass('action-btn')
            .text(action.text)
            .on('click', action.onClick)
            .appendTo($actionsDiv);
    });

    return $actionsDiv;
}

// 消息信息显示
createMessageInfo(message) {
    const infoDiv = document.createElement('div');
    infoDiv.className = 'message-info';
    
    const msgDate = new Date(message.timestamp);
    const now = new Date();
    
    let timeStr;
    if (msgDate.toDateString() === now.toDateString()) {
        // 同一天只显示时间
        timeStr = msgDate.toLocaleTimeString();
    } else {
        // 不同天显示日期和时间
        timeStr = msgDate.toLocaleString();
    }
    
    infoDiv.textContent = `${timeStr}${message.edited ? ' (已编辑)' : ''}`;
    
    return infoDiv;
}

// 修复编辑功能
startEditing(messageId) {
    const $messageDiv = $(`[data-id="${messageId}"]`);
    $messageDiv.addClass('editing');
    const content = this.chatHistory.find(msg => msg.id === messageId).content;

    const $editContainer = $('<div>').addClass('edit-container');
    const $textarea = $('<textarea>')
        .addClass('edit-input')
        .val(content);
    
    // 添加自动调整高度
    const adjustHeight = () => {
        $textarea[0].style.height = 'auto';
        $textarea[0].style.height = $textarea[0].scrollHeight + 'px';
    };
    
    $textarea.on('input', adjustHeight);
    
    const $actions = $('<div>').addClass('edit-actions');
    const $saveBtn = $('<button>')
        .addClass('action-btn')
        .text('保存')
        .on('click', () => this.saveEdit(messageId, $textarea.val()));
    
    const $cancelBtn = $('<button>')
        .addClass('action-btn')
        .text('取消')
        .on('click', () => this.cancelEdit(messageId, content));

    $actions.append($saveBtn, $cancelBtn);
    $editContainer.append($textarea, $actions);
    $messageDiv.find('.message-content').replaceWith($editContainer);
    
    setTimeout(adjustHeight, 0);
    $textarea.focus();
}

saveEdit(messageId, newContent) {
    const index = this.chatHistory.findIndex(msg => msg.id === messageId);
    if (index !== -1) {
        const message = this.chatHistory[index];
        message.content = newContent;
        message.edited = true;
        
        const $messageDiv = $(`[data-id="${messageId}"]`);
        $messageDiv.removeClass('editing');
        
        const $content = $('<div>').addClass('message-content');
        
        if (!message.isUser) {
            let content = this.processThinkContent(newContent);
            $content.html(marked.parse(content));
            
            // 渲染数学公式和高亮代码
            renderMathInElement($content[0], {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\[', right: '\\]', display: true},
                    {left: '\\(', right: '\\)', display: false}
                ],
                throwOnError: false
            });
            
            // 高亮代码
            $content.find('pre code').each((i, block) => {
                const language = block.className.replace('language-', '');
                if (Prism.languages[language]) {
                    Prism.highlightElement(block);
                }
            });
        } else {
            $content.text(newContent);
            
            // 如果编辑的是用户消息，可以选择重新触发AI回复
            if (index + 1 < this.chatHistory.length && !this.chatHistory[index + 1].isUser) {
                this.chatHistory.splice(index + 1); // 删除后续的AI回复
                this.currentResponder = this.chatHistory[index + 1]?.sender;
                this.sendToServer(message);
            }
        }
        
        $messageDiv.find('.edit-container').replaceWith($content);
        this.saveHistory();
    }
}

// 修复取消编辑
cancelEdit(messageId, originalContent) {
    const $messageDiv = $(`[data-id="${messageId}"]`);
    $messageDiv.removeClass('editing');
    const $editContainer = $messageDiv.find('.edit-container');
    
    const $messageContent = $('<div>')
        .addClass('message-content')
        .text(originalContent);
    
    $editContainer.replaceWith($messageContent);
}

// 删除消息
deleteMessage(messageId) {
    const index = this.chatHistory.findIndex(msg => msg.id === messageId);
    if (index !== -1) {
        const message = this.chatHistory[index];
        
        if (message.isUser) {
            // 如果是用户消息，同时删除下一条AI回复
            this.chatHistory.splice(index, index + 1 < this.chatHistory.length ? 2 : 1);
        } else {
            // 如果是AI消息，只删除这一条
            this.chatHistory.splice(index, 1);
        }
        
        this.renderChatHistory();
        this.saveHistory();
    }
}

// 重试消息
async retryMessage(messageId) {
    const messageIndex = this.chatHistory.findIndex(msg => msg.id === messageId);
    if (messageIndex !== -1) {
        const historyUpToMessage = this.chatHistory.slice(0, messageIndex + 1);
        this.chatHistory = historyUpToMessage;
        this.renderChatHistory();
        await this.sendToServer(this.chatHistory[messageIndex]);
    }
}

// 历史记录管理
saveHistory() {
    try {
        const historyWithFormat = this.chatHistory.map(msg => ({
            ...msg,
            content: msg.content.replace(/\n/g, '\n')
        }));
        const historyString = JSON.stringify(historyWithFormat);
        console.log('保存历史记录:', historyString);
        localStorage.setItem('chatHistory', historyString);
    } catch (error) {
        console.error('保存历史记录失败:', error);
        this.showError('保存历史记录失败');
    }
}

loadHistory() {
    try {
        console.log('开始加载历史记录');
        const saved = localStorage.getItem('chatHistory');
        console.log('保存的历史记录:', saved);
        
        if (saved) {
            this.chatHistory = JSON.parse(saved);
            console.log('解析后的历史记录:', this.chatHistory);
            this.renderChatHistory();
        } else {
            console.log('没有找到历史记录');
        }
    } catch (error) {
        console.error('加载历史记录失败:', error);
        this.showError('加载历史记录失败');
        // 清除可能损坏的历史记录
        localStorage.removeItem('chatHistory');
        this.chatHistory = [];
    }
}

async renderChatHistory() {
    console.log('开始渲染历史记录:', this.chatHistory);
    const $messagesContainer = $('#chat-messages');
    $messagesContainer.empty();
    let lastTimestamp = null;

    for (const message of this.chatHistory) {
        const currentTime = new Date(message.timestamp).getTime();
        
        if (!lastTimestamp || (currentTime - lastTimestamp) > 180000) {
            const $timeDiv = $('<div>')
                .addClass('time-divider')
                .text(new Date(currentTime).toLocaleTimeString());
            $messagesContainer.append($timeDiv);
        }
        
        lastTimestamp = currentTime;
        try {
            const $messageElement = await this.renderMessage(message);
            $messagesContainer.append($messageElement);
            await this.renderMessageContent($messageElement, message);
        } catch (err) {
            console.error('渲染消息失败:', err, message);
        }
    }
    
    this.scrollToBottom();
}

async renderMessageContent($element, message) {
    if (!message.isUser) {
        const $content = $element.find('.message-content');
        try {
            const processedContent = await this.contentProcessor.process(message.content);
            $content.html(processedContent);
            
            // 渲染数学公式
            this.renderMath($content[0]);
            
            // 高亮代码
            this.highlightCode($content);
        } catch (err) {
            console.error('渲染消息内容失败:', err);
            $content.html(`<div class="error">渲染失败: ${err.message}</div>`);
        }
    }
}

// 主题切换
toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

// 工具方法
setLoading(loading) {
    const { sendButton } = this.elements;
    this.isProcessing = loading;
    sendButton.disabled = loading;
    sendButton.textContent = loading ? '发送中...' : '发送';
}

scrollToBottom() {
    const $container = $('#chat-messages');
    $container.scrollTop($container[0].scrollHeight);
}

// showError(message) {
//     const errorDiv = document.createElement('div');
//     errorDiv.className = 'message bot error';
//     errorDiv.textContent = `错误: ${message}`;
//     this.elements.messagesContainer.appendChild(errorDiv);
//     this.scrollToBottom();
// }

// 命令处理
handleCommand(command) {
    const commands = {
        '/clear': () => {
            this.chatHistory = [];
            this.renderChatHistory();
            this.saveHistory();
        },
        '/theme': () => this.toggleTheme(),
        '/help': () => this.showHelpMessage(),
        '/export': () => this.exportHistory()
    };

    const cmd = command.split(' ')[0];
    if (commands[cmd]) {
        commands[cmd]();
    } else {
        this.showError('未知命令');
    }
}

handleCommandInput() {
    const { messageInput } = this.elements;
    if (messageInput.value.startsWith('/')) {
        messageInput.classList.add('command-mode');
    } else {
        messageInput.classList.remove('command-mode');
    }
}

// 帮助信息
showHelpMessage() {
    const helpMessage = `
可用命令：
/clear - 清空对话历史
/theme - 切换深色/浅色主题
/export - 导出对话记录
/help - 显示此帮助信息

快捷键：
Ctrl/Cmd + / - 切换主题
Enter - 发送消息
Shift + Enter - 换行
`;
    this.addMessage(helpMessage, false);
}

// 导出历史记录
exportHistory() {
    const exportData = JSON.stringify(this.chatHistory, null, 2);
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-history-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 修复模型选择器
async loadModels() {
    try {
        const models = AVAILABLE_MODELS; // 使用 config.js 中定义的模型
        const $modelSelector = $('#model-selector');
        const defaultModel = localStorage.getItem('defaultModel') || this.defaultModel;
        
        Object.entries(models).forEach(([id, name]) => {
            $('<a>')
                .addClass('a')
                .text(name)
                .attr('data-model', id)
                .on('click', () => this.selectModel(id))
                .appendTo($modelSelector);
        });

        // 自动选择默认模型
        if (defaultModel) {
            this.selectModel(defaultModel);
        }
    } catch (error) {
        this.showError('加载模型列表失败');
    }
}

// 添加模型选择方法
selectModel(id) {
    $('#model-selector .a').removeClass('active');
    $(`[data-model="${id}"]`).addClass('active');
    $('#current-model').text($(`[data-model="${id}"]`).text());
    // 保存选中的模型
    this.currentModel = id;
    localStorage.setItem('defaultModel', id);
}

setupGroupChat() {
    $('#create-group').click(() => this.toggleGroupMode());
    this.renderAssistantList();
    this.setupReplySelector();
}

renderAssistantList() {
    const $list = $('#assistant-list').empty();
    
    if (this.groupMode) {
        // 添加提示信息
        if (this.assistants.length === 0) {
            $list.append(
                $('<div>')
                    .addClass('assistant-status')
                    .text('请选择要加入群聊的AI助手')
            );
        }

        // 添加助手列表
        for (let i = 0; i < GROUP_CHAT_CONFIG.maxAssistants; i++) {
            const isJoined = this.assistants.includes(i);
            const currentModel = this.memberModels.get(i) || this.defaultModel;
            const modelName = AVAILABLE_MODELS[currentModel];
            
            const $item = $(`
                <div class="assistant-item">
                    <div class="assistant-info">
                        <div class="assistant-name">助手${i + 1}</div>
                        <div class="assistant-model">${modelName || '点击选择模型'}</div>
                    </div>
                    <div class="assistant-actions">
                        <select class="model-select" data-index="${i}" ${!isJoined ? 'disabled' : ''}>
                            ${Object.entries(AVAILABLE_MODELS).map(([id, name]) => 
                                `<option value="${id}" ${id === currentModel ? 'selected' : ''}>${name}</option>`
                            ).join('')}
                        </select>
                        <button class="join-btn ${isJoined ? 'joined' : ''}" data-index="${i}">
                            ${isJoined ? '已加入' : '加入讨论'}
                        </button>
                    </div>
                </div>
            `);
            
            $item.find('.join-btn').click(e => {
                e.stopPropagation();
                const idx = $(e.currentTarget).data('index');
                this.toggleAssistantJoin(idx);
            });

            $item.find('.model-select').change(e => {
                const idx = $(e.target).data('index');
                const model = $(e.target).val();
                this.memberModels.set(idx, model);
                localStorage.setItem('memberModels', JSON.stringify([...this.memberModels]));
            });
            
            $list.append($item);
        }

        // 更新群聊状态
        if (this.assistants.length > 0) {
            $list.append(
                $('<div>')
                    .addClass('assistant-status')
                    .html(`已有 ${this.assistants.length} 个助手加入群聊<br>输入@可以选择对话对象`)
            );
        }
    }
}

toggleAssistantJoin(index) {
    const isJoined = this.assistants.includes(index);
    if (isJoined) {
        // 移除助手
        this.assistants = this.assistants.filter(x => x !== index);
        this.addSystemMessage(`助手${index + 1} 已离开群聊`);
    } else {
        // 添加助手
        this.assistants.push(index);
        this.assistants.sort((a, b) => a - b); // 保持顺序
        this.addSystemMessage(`助手${index + 1} 已加入群聊`);
    }
    
    // 更新界面
    this.renderAssistantList();
    
    // 保存群聊状态
    localStorage.setItem('groupAssistants', JSON.stringify(this.assistants));
}

toggleGroupMode() {
    this.groupMode = !this.groupMode;
    $('#create-group').text(this.groupMode ? '退出讨论' : '进入讨论');
    
    // 保存群聊状态
    localStorage.setItem('groupMode', this.groupMode);
    
    if (this.groupMode) {
        const saved = localStorage.getItem('groupAssistants');
        if (saved) {
            this.assistants = JSON.parse(saved);
        }
        
        const savedModels = localStorage.getItem('memberModels');
        if (savedModels) {
            this.memberModels = new Map(JSON.parse(savedModels));
        }
        
        console.log('Entering group mode:', {
            assistants: this.assistants,
            models: this.memberModels
        });
    } else {
        this.assistants = [];
        this.memberModels.clear();
        localStorage.removeItem('groupAssistants');
        localStorage.removeItem('memberModels');
        localStorage.removeItem('groupMode');
    }
    
    this.renderAssistantList();
}

addSystemMessage(content) {
    const $messageDiv = $('<div>')
        .addClass('message system')
        .append($('<div>')
            .addClass('message-content')
            .text(content)
        );
    
    $('#chat-messages').append($messageDiv);
    this.scrollToBottom();
}

setupReplySelector() {
    const $selector = $('<div>').addClass('reply-selector').hide();
    $('.input-container').append($selector);
    
    $('#message-input').on('keyup', e => {
        if (e.key === '@') {
            this.showReplyOptions();
        }
    });
}

showReplyOptions() {
    if (!this.groupMode) return;
    
    const $selector = $('.reply-selector').empty().show();
    
    // 添加用户选项
    this.addReplyOption($selector, 'user', '用户');
    
    // 添加助手选项
    this.assistants.forEach(idx => {
        this.addReplyOption($selector, `assistant${idx + 1}`, `助手${idx + 1}`);
    });
}

addReplyOption($selector, id, name) {
    $('<div>')
        .addClass('reply-option')
        .text(name)
        .on('click', () => {
            const input = $('#message-input')[0];
            const pos = input.selectionStart;
            input.value = input.value.slice(0, pos - 1) + `@${id} ` + input.value.slice(pos);
            $selector.hide();
        })
        .appendTo($selector);
}

highlightCode($container) {
    $container.find('pre code').each((i, block) => {
        const language = block.className.replace('language-', '');
        if (Prism.languages[language]) {
            Prism.highlightElement(block);
        }
    });
}

renderMath(element) {
    renderMathInElement(element, {
        delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false},
            {left: '\\[', right: '\\]', display: true},
            {left: '\\(', right: '\\)', display: false}
        ],
        throwOnError: false
    });
}
}

// 添加think内容交互
$(document).on('click', '.think-content.collapsed', function() {
$(this).removeClass('collapsed')
    .find('.think-toggle i')
    .addClass('bi-chevron-up')
    .removeClass('bi-chevron-down');
});

// 添加思考内容的交互
$(document).on('click', '.think-toggle', function(e) {
e.stopPropagation();
const $content = $(this).closest('.think-content');
const $icon = $(this).find('i');

$content.toggleClass('collapsed');
if ($content.hasClass('collapsed')) {
    $icon.removeClass('bi-chevron-up').addClass('bi-chevron-down');
} else {
    $icon.removeClass('bi-chevron-down').addClass('bi-chevron-up');
}
});

// 在文件末尾添加事件处理
$(document).on('click', '.preview-toggle', function() {
const $content = $(this).closest('.preview-container').find('.preview-content');
const isCodeView = $content.hasClass('code-view');

$content.toggleClass('code-view');
$(this).text(isCodeView ? '查看代码' : '预览');
});

// 初始化
$(document).ready(() => {
try {
    window.chatManager = new ChatManager();
} catch (error) {
    console.error('初始化聊天管理器失败:', error);
    $('#chat-messages').append(
        $('<div>')
            .addClass('message bot error')
            .text('初始化失败，请刷新页面重试')
    );
}
});
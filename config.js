const ENDPOINT = "https://models.github.ai/inference";

const GITHUB_TOKEN = "__your_gh_token__";
// 你的 token，确保有 AI 模型的 read 权限

const AVAILABLE_MODELS = {
    "microsoft/MAI-DS-R1": "MAI DS R1", 
    'deepseek/DeepSeek-V3-0324': 'DS V3',
    'deepseek/DeepSeek-R1': 'DS R1',
    "openai/gpt-4.1": "GPT 4.1",
    "openai/gpt-4.1-nano": "GPT 4.1 nano", 
    "openai/gpt-4.1-mini": "GPT 4.1 mini",
    "openai/gpt-4o": "GPT 4o",
    'openai/gpt-4o-mini':'GPT 4o mini',
    'meta/Llama-4-Scout-17B-16E-Instruct':'Llama 4 Scout',
    'meta/Llama-4-Maverick-17B-128E-Instruct-FP8':'Llama 4 Maverick',
};

const DEFAULT_MODEL = "deepseek/DeepSeek-R1";

// 添加群聊配置
const GROUP_CHAT_CONFIG = {
    maxAssistants: 5, 
    systemPrompt: "这是一个群聊。参与者有：{participants}。你是{name}。你可以用@某人来请求他们回应。使用@来请求下一个回应者。整个回答中，\"@\"只能出现一次，系统只会识别第一个。例如出现 @user 则请求用户回应，用 @assistant(\\d) 则请求另一个AI回应。\n当另一个AI提到你，系统会通过用户发送\"[systeminfo: ...]\"，这是来自系统的临时消息，而不是用户主动发送的。"
};

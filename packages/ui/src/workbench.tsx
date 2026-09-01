"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Badge,
  Breadcrumb,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  Layout,
  Menu,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  FileTextOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { catalog } from "@subtitle/providers/catalog";
import type { AppState, Gateway, Project, PublicProfile } from "@subtitle/core";
import { Editor } from "./editor";
import { ProfileDialog } from "./profile-dialog";
import { Jobs } from "./jobs";
import {
  createCommandQueue,
  duration,
  errorText,
  quiet,
  type Command,
} from "./shared";
const initial: AppState = { projects: [], profiles: [], jobs: [] };
type Auth = {
  authenticated: boolean;
  configured: boolean;
  setupAllowed?: boolean;
};
type Page = "projects" | "settings" | "jobs";
const pageNames = {
  projects: "视频项目",
  settings: "模型与存储",
  jobs: "任务队列",
};

export function Workbench({ gateway }: { gateway: Gateway }) {
  return (
    <ConfigProvider locale={zhCN}>
      <App>
        <WorkbenchContent gateway={gateway} />
      </App>
    </ConfigProvider>
  );
}
function WorkbenchContent({ gateway }: { gateway: Gateway }) {
  const { modal, message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const [auth, setAuth] = useState<Auth | null>(null);
  const [state, setState] = useState<AppState>(initial);
  const [page, setPage] = useState<Page>("projects");
  const [active, setActive] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [upload, setUpload] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<PublicProfile | "new" | null>(null);
  const [profileCategory, setProfileCategory] = useState<
    "asr" | "translation" | "storage"
  >("asr");
  const [library, setLibrary] = useState<string[] | null>(null);
  const [libraryFile, setLibraryFile] = useState<string>();
  const [libraryBusy, setLibraryBusy] = useState(false);
  const pendingRef = useRef(0);
  const stateRef = useRef(state);
  const refreshVersion = useRef(0);
  const enqueue = useRef(createCommandQueue()).current;
  const busy = pending > 0;
  const project = state.projects.find((p) => p.id === active);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const next = await gateway.call<AppState>("state");
    if (version === refreshVersion.current) {
      stateRef.current = next;
      setState(next);
    }
  }, [gateway]);
  const loadAuth = useCallback(async () => {
    setError("");
    try {
      setAuth(await gateway.call<Auth>("auth.status"));
    } catch (e) {
      setError(errorText(e));
    }
  }, [gateway]);
  useEffect(() => {
    quiet(loadAuth());
  }, [loadAuth]);
  useEffect(() => {
    if (!auth?.authenticated) return;
    setLoading(true);
    refresh()
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
    const timer = setInterval(() => {
      if (!pendingRef.current) quiet(refresh());
    }, 4000);
    return () => {
      clearInterval(timer);
      refreshVersion.current++;
    };
  }, [auth?.authenticated, refresh]);
  const perform = useCallback(
    <T,>(task: () => Promise<T>): Promise<T> => {
      pendingRef.current++;
      setPending(pendingRef.current);
      refreshVersion.current++;
      return enqueue(async () => {
        setError("");
        try {
          const result = await task();
          try {
            await refresh();
          } catch {
            setError(
              "操作已完成，但状态刷新失败；请点击刷新，不要重复提交任务。",
            );
          }
          return result;
        } catch (e) {
          setError(errorText(e));
          throw e;
        } finally {
          pendingRef.current--;
          setPending(pendingRef.current);
        }
      });
    },
    [enqueue, refresh],
  );
  const command: Command = useCallback(
    (method, args = {}) =>
      perform(() => {
        const guarded = [
          "subtitle.edit",
          "subtitle.split",
          "subtitle.merge",
          "subtitle.replace",
        ];
        const current = stateRef.current.projects.find((p) => p.id === args.id);
        return gateway.call(
          method,
          guarded.includes(method) && current
            ? { expectedRevision: current.document.revision, ...args }
            : args,
        );
      }),
    [gateway, perform],
  );
  function openProject(id: string) {
    setActive(id);
    setPage("projects");
  }
  async function importVideo() {
    setUpload(0);
    try {
      const p = await perform(() => gateway.pickVideo(setUpload));
      if (p) openProject(p.id);
    } catch {
    } finally {
      setUpload(null);
    }
  }
  async function openLibrary() {
    setLibraryFile(undefined);
    try {
      setLibrary(await command("library.list"));
    } catch {}
  }
  if (!auth)
    return (
      <div className="wb-login">
        <Card title="字幕工作台" className="wb-login-card">
          {error ? (
            <Space orientation="vertical">
              <Alert type="error" showIcon title={error} />
              <Button onClick={() => quiet(loadAuth())}>重新连接</Button>
            </Space>
          ) : (
            <Flex justify="center" gap={12}>
              <Spin />
              正在连接工作台…
            </Flex>
          )}
        </Card>
      </div>
    );
  if (!auth.authenticated)
    return (
      <div className="wb-login">
        <Card
          className="wb-login-card"
          title={
            <Space>
              <FileTextOutlined />
              字幕工作台
            </Space>
          }
        >
          <Typography.Title level={4}>
            {auth.configured ? "管理员登录" : "初始化工作台"}
          </Typography.Title>
          {!auth.configured && (
            <Alert
              className="wb-gap"
              type="info"
              showIcon
              title="设置管理员"
              description="可在终端运行 npm run setup，或使用部署时配置的初始化令牌。密码至少 12 位。"
            />
          )}
          {error && (
            <Alert className="wb-gap" type="error" showIcon title={error} />
          )}
          <Form
            layout="vertical"
            onFinish={async (values) => {
              setLoading(true);
              setError("");
              try {
                await gateway.call(
                  auth.configured ? "auth.login" : "auth.setup",
                  values,
                );
                setAuth({ authenticated: true, configured: true });
              } catch (e) {
                setError(errorText(e));
              } finally {
                setLoading(false);
              }
            }}
          >
            {!auth.configured && (
              <Form.Item
                name="setupToken"
                label="初始化令牌"
                rules={[{ required: true }]}
              >
                <Input.Password autoComplete="off" />
              </Form.Item>
            )}
            <Form.Item
              name="password"
              label="管理员密码"
              rules={[{ required: true }, { min: auth.configured ? 1 : 12 }]}
            >
              <Input.Password
                autoComplete={
                  auth.configured ? "current-password" : "new-password"
                }
              />
            </Form.Item>
            <Button
              block
              type="primary"
              htmlType="submit"
              loading={loading}
              disabled={!auth.configured && !auth.setupAllowed}
            >
              {auth.configured ? "登录" : "创建管理员"}
            </Button>
          </Form>
          <Typography.Paragraph type="secondary" className="wb-login-note">
            数据保存在当前设备或自托管服务器。
          </Typography.Paragraph>
        </Card>
      </div>
    );
  return (
    <Layout className="wb-layout">
      <Layout.Sider
        theme="light"
        width={208}
        collapsible
        collapsed={collapsed}
        collapsedWidth={0}
        breakpoint="lg"
        trigger={null}
        onBreakpoint={setCollapsed}
      >
        <div className="wb-brand">
          <FileTextOutlined />
          <strong>字幕工作台</strong>
        </div>
        <Menu
          selectedKeys={[page]}
          mode="inline"
          onClick={({ key }) => {
            setPage(key as Page);
            setActive("");
            if (!screens.lg) setCollapsed(true);
          }}
          items={[
            {
              key: "projects",
              icon: <VideoCameraOutlined />,
              label: "视频项目",
            },
            {
              key: "jobs",
              icon: <UnorderedListOutlined />,
              label: (
                <Space>
                  任务队列
                  <Badge
                    count={
                      state.jobs.filter((j) =>
                        ["queued", "running"].includes(j.status),
                      ).length
                    }
                  />
                </Space>
              ),
            },
            { key: "settings", icon: <SettingOutlined />, label: "模型与存储" },
          ]}
        />
        <div className="wb-sidebar-note">
          <Tag>{gateway.platform.toUpperCase()}</Tag>
          <Typography.Paragraph type="secondary">
            {gateway.platform === "web"
              ? "自托管服务 · 家庭共享空间"
              : "本机处理 · 独立运行"}
          </Typography.Paragraph>
        </div>
      </Layout.Sider>
      <Layout className="wb-body">
        <Layout.Header className="wb-header">
          <Flex align="center" justify="space-between" gap={12}>
            <Space>
              <Button
                type="text"
                aria-label={collapsed ? "展开导航" : "收起导航"}
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
              />
              <Breadcrumb
                items={[
                  ...(screens.md ? [{ title: "工作空间" }] : []),
                  { title: pageNames[page] },
                  ...(screens.md && project && page === "projects"
                    ? [{ title: project.name }]
                    : []),
                ]}
              />
            </Space>
            <Space>
              <Button
                aria-label="刷新工作台"
                icon={<ReloadOutlined />}
                loading={loading}
                disabled={busy}
                onClick={() => {
                  setLoading(true);
                  refresh()
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setLoading(false));
                }}
              />
              {gateway.platform === "web" && (
                <Button
                  icon={<LogoutOutlined />}
                  disabled={busy}
                  onClick={() =>
                    quiet(
                      (async () => {
                        try {
                          await gateway.call("auth.logout");
                          refreshVersion.current++;
                          setAuth({ ...auth, authenticated: false });
                          setState(initial);
                          stateRef.current = initial;
                          setActive("");
                        } catch (e) {
                          setError(errorText(e));
                        }
                      })(),
                    )
                  }
                >
                  退出
                </Button>
              )}
            </Space>
          </Flex>
        </Layout.Header>
        <Layout.Content className="wb-content">
          {error && (
            <Alert
              className="wb-gap"
              type="error"
              showIcon
              closable={{ onClose: () => setError("") }}
              title={error}
            />
          )}
          {upload !== null && (
            <Card size="small" className="wb-gap">
              <Typography.Text>正在导入视频</Typography.Text>
              <Progress percent={upload} />
            </Card>
          )}
          {page === "projects" && !project && (
            <>
              <div className="wb-page-heading">
                <Typography.Title level={3}>视频项目</Typography.Title>
                <Space wrap>
                  <Button
                    icon={<FileTextOutlined />}
                    disabled={busy}
                    onClick={() =>
                      quiet(
                        command("project.blank", {
                          name: "未命名字幕文档",
                        }).then((p: Project) => openProject(p.id)),
                      )
                    }
                  >
                    新建字幕文档
                  </Button>
                  {gateway.platform === "web" && (
                    <Button
                      icon={<FolderOpenOutlined />}
                      disabled={busy}
                      onClick={openLibrary}
                    >
                      服务器媒体目录
                    </Button>
                  )}
                  <Button
                    type="primary"
                    icon={<UploadOutlined />}
                    loading={upload !== null}
                    disabled={busy}
                    onClick={importVideo}
                  >
                    导入视频
                  </Button>
                </Space>
              </div>
              <Alert
                type="info"
                showIcon
                title="字幕生成与视频烧录分别执行。可导入已有 SRT / VTT，直接编辑、翻译或导出。"
                className="wb-gap"
              />
              <Card
                title={`项目列表（${state.projects.length}）`}
                extra={
                  <Input.Search
                    aria-label="搜索项目"
                    placeholder="搜索项目"
                    allowClear
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="wb-search"
                  />
                }
              >
                <Table<Project>
                  rowKey="id"
                  loading={loading}
                  dataSource={state.projects.filter((p) =>
                    p.name.toLowerCase().includes(query.toLowerCase()),
                  )}
                  scroll={{ x: 700 }}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  locale={{
                    emptyText: (
                      <Empty
                        description={
                          query
                            ? "没有匹配的项目"
                            : "暂无项目，请导入视频或新建字幕文档"
                        }
                      />
                    ),
                  }}
                  columns={[
                    {
                      title: "项目名称",
                      dataIndex: "name",
                      render: (name, p) => (
                        <Button type="link" onClick={() => openProject(p.id)}>
                          {name}
                        </Button>
                      ),
                    },
                    {
                      title: "时长",
                      width: 115,
                      render: (_, p) =>
                        p.media ? duration(p.media.durationMs) : "纯字幕",
                    },
                    {
                      title: "字幕",
                      width: 90,
                      render: (_, p) => `${p.document.cues.length} 条`,
                    },
                    {
                      title: "更新时间",
                      width: 180,
                      render: (_, p) =>
                        new Date(p.updatedAt).toLocaleString("zh-CN"),
                    },
                    {
                      title: "操作",
                      width: 90,
                      render: (_, p) => (
                        <Button onClick={() => openProject(p.id)}>打开</Button>
                      ),
                    },
                  ]}
                />
              </Card>
            </>
          )}
          {page === "projects" && project && (
            <Editor
              key={project.id}
              project={project}
              profiles={state.profiles}
              gateway={gateway}
              command={command}
              busy={busy}
              onBack={() => setActive("")}
              onError={setError}
              onJobs={() => setPage("jobs")}
            />
          )}
          {page === "jobs" && (
            <Jobs
              state={state}
              gateway={gateway}
              command={command}
              busy={busy}
              openProject={openProject}
            />
          )}
          {page === "settings" && (
            <>
              <div className="wb-page-heading">
                <Typography.Title level={3}>模型与存储</Typography.Title>
              </div>
              <Alert
                className="wb-gap"
                showIcon
                type="info"
                title="使用你自己的凭据。保存配置不会调用收费接口，也不会自动切换厂商。"
              />
              <Card>
                <Tabs
                  items={(
                    [
                      ["asr", "语音识别"],
                      ["translation", "字幕翻译"],
                      ["storage", "临时音频存储"],
                    ] as const
                  ).map(([category, label]) => ({
                    key: category,
                    label,
                    children: (
                      <Space
                        orientation="vertical"
                        className="wb-full"
                        size="middle"
                      >
                        <Flex
                          justify="space-between"
                          align="center"
                          wrap
                          gap={12}
                        >
                          <Typography.Text type="secondary">
                            {category === "asr"
                              ? "音频识别与时间戳能力"
                              : category === "translation"
                                ? "翻译、AI 断句与字幕指令修改"
                                : "只用于需要 URL / 对象 URI 的识别服务"}
                          </Typography.Text>
                          <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => {
                              setProfileCategory(category);
                              setProfile("new");
                            }}
                          >
                            添加{label}配置
                          </Button>
                        </Flex>
                        <Table<PublicProfile>
                          rowKey="id"
                          scroll={{ x: 900 }}
                          pagination={false}
                          dataSource={state.profiles.filter(
                            (p) =>
                              catalog.find((d) => d.id === p.provider)
                                ?.category === category,
                          )}
                          columns={[
                            { title: "名称", dataIndex: "name" },
                            {
                              title: "厂商",
                              render: (_, p) =>
                                catalog.find((d) => d.id === p.provider)?.name,
                            },
                            { title: "模型 / 接口", dataIndex: "model" },
                            {
                              title: "联调状态",
                              width: 180,
                              render: (_, p) => (
                                <Space orientation="vertical" size={0}>
                                  <Tag
                                    color={
                                      p.verification === "verified"
                                        ? "success"
                                        : "default"
                                    }
                                  >
                                    {p.verification === "verified"
                                      ? "测试通过"
                                      : "未通过测试"}
                                  </Tag>
                                  {p.verificationMessage && (
                                    <Typography.Text type="secondary" ellipsis>
                                      {p.verificationMessage}
                                    </Typography.Text>
                                  )}
                                </Space>
                              ),
                            },
                            {
                              title: "操作",
                              width: 230,
                              render: (_, p) => (
                                <Space>
                                  <Button
                                    size="small"
                                    loading={busy}
                                    onClick={() =>
                                      modal.confirm({
                                        title: `测试「${p.name}」？`,
                                        content:
                                          category === "storage"
                                            ? "将上传并删除一个很小的临时对象。"
                                            : "将发起一个很小的真实请求，厂商可能收取少量费用。需要 URL 的识别服务会使用已有的兼容存储配置。",
                                        okText: "开始测试",
                                        onOk: async () => {
                                          const result = await command(
                                            "profile.test",
                                            { id: p.id },
                                          );
                                          if (result.ok)
                                            message.success(result.message);
                                          else message.error(result.message);
                                        },
                                      })
                                    }
                                  >
                                    测试服务
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={() => {
                                      setProfileCategory(category);
                                      setProfile(p);
                                    }}
                                  >
                                    编辑
                                  </Button>
                                  <Button
                                    size="small"
                                    danger
                                    disabled={busy}
                                    onClick={() =>
                                      modal.confirm({
                                        title: `删除「${p.name}」？`,
                                        content: "使用此配置的任务可能受影响。",
                                        okText: "删除",
                                        okButtonProps: { danger: true },
                                        onOk: () =>
                                          command("profile.delete", {
                                            id: p.id,
                                          }),
                                      })
                                    }
                                  >
                                    删除
                                  </Button>
                                </Space>
                              ),
                            },
                          ]}
                        />
                      </Space>
                    ),
                  }))}
                />
              </Card>
            </>
          )}
        </Layout.Content>
      </Layout>
      {profile && (
        <ProfileDialog
          profile={profile === "new" ? undefined : profile}
          category={profileCategory}
          close={() => setProfile(null)}
          command={command}
        />
      )}
      <Modal
        title="选择服务器媒体文件"
        open={library !== null}
        confirmLoading={libraryBusy}
        okText="导入"
        okButtonProps={{ disabled: !libraryFile }}
        onCancel={() => !libraryBusy && setLibrary(null)}
        onOk={async () => {
          setLibraryBusy(true);
          try {
            const p = await command("library.import", { name: libraryFile });
            setLibrary(null);
            openProject(p.id);
            message.success("视频已导入");
          } catch {
          } finally {
            setLibraryBusy(false);
          }
        }}
      >
        {library?.length ? (
          <Select
            className="wb-full"
            aria-label="服务器媒体文件"
            showSearch
            optionFilterProp="label"
            placeholder="选择视频文件"
            options={library.map((name) => ({ value: name, label: name }))}
            value={libraryFile}
            onChange={setLibraryFile}
          />
        ) : (
          <Empty description="媒体目录为空或未配置 SUBTITLE_MEDIA_ROOT" />
        )}
      </Modal>
    </Layout>
  );
}

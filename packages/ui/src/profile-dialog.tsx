"use client";
import React, { useState } from "react";
import {
  Alert,
  AutoComplete,
  Checkbox,
  Divider,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { catalog } from "@subtitle/providers/catalog";
import type { PublicProfile } from "@subtitle/core";
import { errorText, type Command } from "./shared";

export function ProfileDialog({
  profile,
  category,
  close,
  command,
}: {
  profile?: PublicProfile;
  category: "asr" | "translation" | "storage";
  close: () => void;
  command: Command;
}) {
  const [form] = Form.useForm();
  const initialProvider =
    profile?.provider || catalog.find((item) => item.category === category)!.id;
  const [provider, setProvider] = useState(initialProvider);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const definition = catalog.find((p) => p.id === provider)!;
  const selectedModel = Form.useWatch("model", form) || definition.models[0];
  const selectedDetail = definition.modelDetails?.find(
    (item) => item.id === selectedModel,
  );
  return (
    <Modal
      open
      title={
        profile
          ? "编辑配置"
          : `添加${category === "asr" ? "语音识别" : category === "translation" ? "翻译 / AI" : "临时存储"}配置`
      }
      width={680}
      onCancel={() => !saving && close()}
      onOk={() => form.submit()}
      confirmLoading={saving}
      okText="保存配置"
      cancelButtonProps={{ disabled: saving }}
      mask={{ closable: !saving }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: profile?.name,
          provider: initialProvider,
          model: profile?.model || definition.models[0] || "",
          options: profile?.options || {},
          secrets: {},
          allowPrivateEndpoint: profile?.allowPrivateEndpoint || false,
        }}
        onFinish={async (values) => {
          setSaving(true);
          setError("");
          try {
            const options: Record<string, string> = {},
              secrets: Record<string, string> = {};
            for (const field of definition.fields)
              (field.secret ? secrets : options)[field.key] = String(
                (field.secret ? values.secrets : values.options)?.[field.key] ||
                  "",
              );
            await command("profile.save", {
              id: profile?.id,
              name: values.name.trim(),
              provider,
              model: values.model || "",
              options,
              secrets,
              allowPrivateEndpoint: !!values.allowPrivateEndpoint,
            });
            close();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        {error && (
          <Alert className="wb-gap" showIcon type="error" title={error} />
        )}
        <Form.Item
          name="name"
          label="配置名称"
          rules={[{ required: true, whitespace: true }, { max: 120 }]}
        >
          <Input placeholder="例如：我的中文识别" />
        </Form.Item>
        <Divider titlePlacement="start">服务与模型</Divider>
        <Form.Item name="provider" label="服务商" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            disabled={!!profile}
            options={catalog
              .filter((p) => p.category === category)
              .map((p) => ({ value: p.id, label: p.name }))}
            onChange={(value) => {
              form.resetFields(["model", "options", "secrets"]);
              form.setFieldsValue({
                model: catalog.find((p) => p.id === value)?.models[0] || "",
                options: {},
                secrets: {},
              });
              setProvider(value);
              setError("");
            }}
          />
        </Form.Item>
        <Form.Item
          name="model"
          label="模型 / 接口模式"
          rules={[
            { required: definition.category !== "storage" },
            { max: 200 },
          ]}
        >
          <AutoComplete
            options={(
              definition.modelDetails ||
              definition.models.map((id) => ({ id, label: id }))
            ).map((model) => ({
              value: model.id,
              label: model.label || model.id,
            }))}
            placeholder="选择或输入模型名称"
            filterOption={(input, option) =>
              !!option?.value.toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Space wrap className="wb-gap">
          {selectedDetail?.status && (
            <Tag
              color={
                selectedDetail.status === "recommended" ? "green" : undefined
              }
            >
              {selectedDetail.status === "recommended"
                ? "推荐模型"
                : selectedDetail.status === "legacy"
                  ? "兼容旧模型"
                  : "当前模型"}
            </Tag>
          )}
          {definition.input && <Tag>输入：{definition.input}</Tag>}
          {definition.timestamps && <Tag>时间戳：{definition.timestamps}</Tag>}
          {definition.maxChunkSeconds && (
            <Tag>分片上限：{definition.maxChunkSeconds} 秒</Tag>
          )}
          {definition.speakerDiarization && <Tag>说话人分离</Tag>}
          {definition.aiOperations && <Tag color="blue">AI 断句 / 改写</Tag>}
          {definition.checkedAt && <Tag>资料核对：{definition.checkedAt}</Tag>}
        </Space>
        {selectedDetail?.note && (
          <Typography.Paragraph type="secondary" className="wb-gap">
            {selectedDetail.note}
          </Typography.Paragraph>
        )}
        {(
          [
            ["credentials", "凭据"],
            ["endpoint", "区域与服务地址"],
            ["advanced", "高级选项"],
          ] as const
        ).map(([section, title]) => {
          const fields = definition.fields.filter(
            (field) =>
              (field.section || (field.secret ? "credentials" : "advanced")) ===
              section,
          );
          if (!fields.length) return null;
          return (
            <React.Fragment key={section}>
              <Divider titlePlacement="start">{title}</Divider>
              <div
                className={
                  section === "credentials" ? "wb-form-grid" : undefined
                }
              >
                {fields.map((field) => (
                  <Form.Item
                    key={`${provider}:${field.key}`}
                    preserve={false}
                    name={[field.secret ? "secrets" : "options", field.key]}
                    label={field.label}
                    extra={
                      field.secret && profile?.secretFields.includes(field.key)
                        ? "已加密保存，留空保持不变"
                        : undefined
                    }
                    rules={[
                      {
                        required:
                          !field.optional &&
                          !(
                            field.secret &&
                            profile?.secretFields.includes(field.key)
                          ),
                        whitespace: true,
                      },
                    ]}
                  >
                    {field.key === "serviceAccount" ? (
                      <Input.TextArea
                        rows={4}
                        autoComplete="off"
                        placeholder="粘贴 Service Account JSON"
                      />
                    ) : field.secret ? (
                      <Input.Password
                        autoComplete="new-password"
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <Input placeholder={field.placeholder} />
                    )}
                  </Form.Item>
                ))}
              </div>
            </React.Fragment>
          );
        })}
        {definition.note && (
          <Alert
            className="wb-gap"
            showIcon
            type="info"
            title={definition.note}
          />
        )}
        <Form.Item name="allowPrivateEndpoint" valuePropName="checked">
          <Checkbox>
            允许访问内网 / HTTP 地址（仅用于信任的自定义服务）
          </Checkbox>
        </Form.Item>
        <Typography.Text type="secondary">
          保存后请在配置列表点击“测试服务”；测试会发起小型真实请求。
        </Typography.Text>{" "}
        {definition.docs && (
          <Typography.Link
            href={definition.docs}
            target="_blank"
            rel="noreferrer"
          >
            官方接口文档
          </Typography.Link>
        )}
      </Form>
    </Modal>
  );
}

import React, { useState } from "react";
import { Text, View } from "react-native";
import { Resource } from "../core";
import { AppColors } from "./theme";
import { Action, Field } from "./CollectionControls";
export function OrderedTracks({
  ids,
  resources,
  onAdd,
  onRemove,
  onMove,
  colors: c,
  disabled = false,
}: {
  ids: string[];
  resources: Resource[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  colors: AppColors;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [limit, setLimit] = useState(30),
    [trackLimit, setTrackLimit] = useState(40);
  const available = resources.filter(
    (r) =>
      !ids.includes(r.id) &&
      `${r.title} ${r.author ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <View style={{ gap: 16, marginTop: 22 }}>
      <Text
        accessibilityRole="header"
        style={{ color: c.text, fontSize: 23, fontWeight: "600" }}
      >
        已加入曲目 · {ids.length}
      </Text>
      {!ids.length && (
        <Text style={{ color: c.muted, lineHeight: 23 }}>
          还没有曲目，从下面加入资料。
        </Text>
      )}
      {ids.slice(0, trackLimit).map((id, i) => {
        const r = resources.find((r) => r.id === id),
          name = r?.title ?? "资料已删除";
        return (
          <View
            testID={`ordered-track-${i}`}
            key={`${id}:${ids.slice(0, i).filter((x) => x === id).length}`}
            style={{
              borderColor: c.line,
              borderWidth: 1,
              padding: 14,
              borderRadius: 10,
              gap: 12,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <Text
                style={{
                  color: c.muted,
                  fontSize: 14,
                  minWidth: 24,
                  lineHeight: 27,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </Text>
              <Text
                style={{ color: c.text, fontSize: 18, lineHeight: 27, flex: 1 }}
              >
                {name}
              </Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
              <Action
                text="上移"
                label={`上移 ${name}`}
                onPress={() => onMove(id, -1)}
                colors={c}
                disabled={disabled || i === 0}
              />
              <Action
                text="下移"
                label={`下移 ${name}`}
                onPress={() => onMove(id, 1)}
                colors={c}
                disabled={disabled || i === ids.length - 1}
              />
              <Action
                text="移除"
                label={`移除 ${name}`}
                onPress={() => onRemove(id)}
                colors={c}
                disabled={disabled}
              />
            </View>
          </View>
        );
      })}
      {ids.length > trackLimit && (
        <Action
          text="更多曲目"
          onPress={() => setTrackLimit((v) => v + 40)}
          colors={c}
        />
      )}
      <Text
        accessibilityRole="header"
        style={{ color: c.text, fontSize: 23, fontWeight: "600", marginTop: 8 }}
      >
        可加入资料
      </Text>
      <Field
        label="查找资料"
        value={query}
        onChange={(v) => {
          setQuery(v);
          setLimit(30);
        }}
        colors={c}
      />
      {!available.length && (
        <Text style={{ color: c.muted, lineHeight: 23 }}>
          {resources.length
            ? "没有其他匹配资料"
            : "暂无资料，请先新建或导入文稿。"}
        </Text>
      )}
      {available.slice(0, limit).map((r) => (
        <View
          key={r.id}
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderColor: c.line,
          }}
        >
          <Text
            style={{
              color: c.text,
              fontSize: 17,
              lineHeight: 26,
              flexGrow: 1,
              flexBasis: 180,
            }}
          >
            {r.title}
          </Text>
          <Action
            text="加入"
            label={`加入 ${r.title}`}
            onPress={() => onAdd(r.id)}
            colors={c}
            disabled={disabled}
          />
        </View>
      ))}
      {available.length > limit && (
        <Action
          text="更多资料"
          onPress={() => setLimit((v) => v + 30)}
          colors={c}
        />
      )}
    </View>
  );
}

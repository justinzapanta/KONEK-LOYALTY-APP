import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { BranchAccess } from "../services/api/loyalty";
import { Button } from "./FormControls";
import { colors } from "../theme/tokens";

// A visible track avoids relying on Android's theme-dependent native indicator.
function AccountScrollArea({
  hint,
  style,
  children,
  ...props
}: ScrollViewProps & { hint: string }) {
  const scroll = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const range = Math.max(0, content - viewport);
  const position = Math.max(0, Math.min(offset, range));
  const overflowing = viewport > 0 && range > 2;
  const moreBelow = overflowing && range - position > 4;
  const trackHeight = Math.max(0, viewport - 16);
  const thumbHeight = Math.min(
    trackHeight,
    Math.max(28, (trackHeight * viewport) / Math.max(content, 1)),
  );
  const thumbTop =
    range > 0 ? ((trackHeight - thumbHeight) * position) / range : 0;
  return (
    <View style={[styles.scrollArea, style]}>
      <View style={styles.scrollFrame}>
        <ScrollView
          {...props}
          ref={scroll}
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
          onContentSizeChange={(_, height) => setContent(height)}
          onScroll={(event) => setOffset(event.nativeEvent.contentOffset.y)}
        >
          {children}
        </ScrollView>
        {overflowing && (
          <View
            pointerEvents="none"
            accessible={false}
            style={styles.scrollTrack}
          >
            <View
              style={[
                styles.scrollThumb,
                { height: thumbHeight, transform: [{ translateY: thumbTop }] },
              ]}
            />
          </View>
        )}
      </View>
      {moreBelow && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hint}
          onPress={() =>
            scroll.current?.scrollTo({
              y: Math.min(range, position + viewport * 0.7),
              animated: true,
            })
          }
          style={styles.scrollHint}
        >
          <Text style={styles.scrollHintText}>{hint}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.dark} />
        </Pressable>
      )}
    </View>
  );
}

export function AccountMenu({
  branchAccess,
  onBranchChange,
  visible,
  name,
  email,
  businessName,
  initials,
  signingOut,
  onClose,
  onSignOut,
  onConnectCounter,
}: {
  branchAccess?: BranchAccess;
  onBranchChange: (id: string) => void;
  visible: boolean;
  name: string;
  email: string;
  businessName: string;
  initials: string;
  onConnectCounter: () => void;
  signingOut: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!visible) {
      setBranchOpen(false);
      setSearch("");
    }
  }, [visible]);
  const branches = (branchAccess?.branches || []).filter(
    (branch) =>
      branch.status === "active" &&
      branch.name
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const close = () => {
    if (!signingOut) onClose();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.backdrop}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss account menu"
          disabled={signingOut}
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>
              My account
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close account menu"
              disabled={signingOut}
              onPress={close}
              hitSlop={8}
              style={styles.close}
            >
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <AccountScrollArea
            hint="Scroll down to see more"
            keyboardShouldPersistTaps="handled"
            bounces={false}
            contentContainerStyle={styles.body}
          >
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text style={styles.initials}>{initials}</Text>
              </View>
              <View style={styles.details}>
                <Text style={styles.name}>{name}</Text>
                {!!email && <Text style={styles.email}>{email}</Text>}
              </View>
            </View>
            <View style={styles.workspace}>
              <Ionicons name="business-outline" size={21} color={colors.ink} />
              <View style={styles.details}>
                <Text style={styles.label}>BUSINESS WORKSPACE</Text>
                <Text style={styles.business}>{businessName}</Text>
              </View>
            </View>
            {!!branchAccess && (
              <View style={styles.branchSection}>
                <Text style={styles.label}>WORKING BRANCH</Text>
                {branchAccess.can_select ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Working branch: ${branchAccess.branch_name}. Change branch`}
                      accessibilityState={{
                        expanded: branchOpen,
                        disabled: signingOut,
                      }}
                      disabled={signingOut}
                      onPress={() => setBranchOpen((open) => !open)}
                      style={({ pressed }) => [
                        styles.branchToggle,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons
                        name="location-outline"
                        size={20}
                        color={colors.dark}
                      />
                      <Text style={styles.branchName}>
                        {branchAccess.branch_name}
                      </Text>
                      <Ionicons
                        name={branchOpen ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={colors.dark}
                      />
                    </Pressable>
                    {branchOpen && (
                      <View style={styles.branchPicker}>
                        <Text style={styles.branchCount}>
                          {branches.length}{" "}
                          {branches.length === 1 ? "branch" : "branches"}
                          {search.trim() ? " found" : " available"}
                        </Text>
                        <View style={styles.searchRow}>
                          <Ionicons
                            name="search-outline"
                            size={18}
                            color={colors.muted}
                          />
                          <TextInput
                            accessibilityLabel="Search branches"
                            placeholder="Search branches"
                            placeholderTextColor={colors.muted}
                            value={search}
                            onChangeText={setSearch}
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.searchInput}
                          />
                          {!!search && (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Clear branch search"
                              hitSlop={8}
                              onPress={() => setSearch("")}
                            >
                              <Ionicons
                                name="close-circle"
                                size={19}
                                color={colors.muted}
                              />
                            </Pressable>
                          )}
                        </View>
                        <AccountScrollArea
                          hint="More branches below"
                          nestedScrollEnabled
                          keyboardShouldPersistTaps="handled"
                          style={styles.branchResults}
                        >
                          {branches.map((branch) => (
                            <Pressable
                              key={branch.id}
                              accessibilityRole="button"
                              accessibilityState={{
                                selected: branchAccess.branch_id === branch.id,
                                disabled: signingOut,
                              }}
                              disabled={signingOut}
                              onPress={() => {
                                setBranchOpen(false);
                                setSearch("");
                                if (branch.id !== branchAccess.branch_id)
                                  onBranchChange(branch.id);
                              }}
                              style={({ pressed }) => [
                                styles.branchOption,
                                branchAccess.branch_id === branch.id &&
                                  styles.selectedBranch,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.branchName}>
                                {branch.name}
                              </Text>
                              {branchAccess.branch_id === branch.id && (
                                <Ionicons
                                  name="checkmark"
                                  size={19}
                                  color={colors.dark}
                                />
                              )}
                            </Pressable>
                          ))}
                          {!branches.length && (
                            <Text style={styles.emptySearch}>
                              No branches match your search.
                            </Text>
                          )}
                        </AccountScrollArea>
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={styles.business}>
                    {branchAccess.branch_name}
                  </Text>
                )}
                <Text style={styles.email}>
                  {branchAccess.can_select
                    ? "Purchases and rewards are recorded at this branch."
                    : "Your branch is assigned by an owner or Admin."}
                </Text>
              </View>
            )}
            {!!branchAccess?.branch_id && (
              <View style={styles.branchSection}>
                <Text style={styles.label}>POS CONNECTION</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={signingOut}
                  accessibilityState={{ disabled: signingOut }}
                  onPress={onConnectCounter}
                  style={({ pressed }) => [
                    styles.counterButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.counterIcon}>
                    <Ionicons
                      name="desktop-outline"
                      size={22}
                      color={colors.dark}
                    />
                  </View>
                  <View style={styles.details}>
                    <Text style={styles.counterTitle}>
                      Connect to a counter
                    </Text>
                    <Text style={styles.email}>
                      Connect or manage this phone’s POS counter.
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={colors.dark}
                  />
                </Pressable>
              </View>
            )}
            <Button
              title={signingOut ? "Signing out…" : "Sign out"}
              variant="secondary"
              loading={signingOut}
              onPress={onSignOut}
            />
          </AccountScrollArea>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "rgba(8,23,17,0.48)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "85%",
    borderRadius: 28,
    backgroundColor: colors.cream,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  body: { padding: 24, gap: 22 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollArea: { flexShrink: 1, minHeight: 0 },
  scrollFrame: { flexShrink: 1, minHeight: 0 },
  scrollTrack: {
    position: "absolute",
    right: 5,
    top: 8,
    bottom: 8,
    width: 5,
    borderRadius: 3,
    backgroundColor: "#D5E1DA",
  },
  scrollThumb: { width: 5, borderRadius: 3, backgroundColor: "#54665B" },
  scrollHint: {
    minHeight: 36,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: "#E5F3E5",
  },
  scrollHintText: {
    color: colors.dark,
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  branchCount: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 3,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { color: colors.ink, fontSize: 20, fontWeight: "800" },
  details: { flex: 1, minWidth: 0 },
  name: { color: colors.ink, fontSize: 20, fontWeight: "800" },
  email: { color: colors.muted, fontSize: 13, marginTop: 5 },
  workspace: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  branchSection: { gap: 9 },
  branchToggle: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  branchName: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "600" },
  branchPicker: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: colors.white,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    color: colors.ink,
    fontSize: 14,
  },
  branchResults: { maxHeight: 176 },
  branchOption: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectedBranch: { backgroundColor: "#E7F8E9" },
  emptySearch: { padding: 16, fontSize: 13, color: colors.muted },
  pressed: { opacity: 0.72 },
  counterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#A7D6B7",
    borderRadius: 16,
    backgroundColor: "#E7F8E9",
  },
  counterIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  counterTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  business: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 5,
  },
});

# Node.js Contribution Board

Contribution Board에 콘텐츠를 추가하려면 아래 형식에 따라 작성합니다.

## contributions

기여 현황의 Pull Request에서 연결되는 기여 노트 페이지에 표시됩니다.

파일명은 `nodejs/node` Pull Request 번호입니다.
예: `contributions/12345.md`

```md
---
pr-url: https://github.com/nodejs/node/pull/12345
# url: https://example.com/contribution
---

## 문제 내용

문제와 확인 방법을 적습니다.

## 해결 과정과 검증

해결 방법과 검증 결과를 적습니다.

## 배운 점

기여하며 배운 내용을 적습니다.
```

이미지는 contributions/resources에 저장하고, PR 번호가 포함된 상대 경로로 참조합니다.

```text
contributions/resources/12345-debugger.png
```

```md
![검증 화면](./resources/12345-debugger.png)
```

## profiles

기여자 이름에서 연결되는 프로필 페이지에 표시됩니다.

파일명은 canonical GitHub ID를 소문자로 작성합니다.
예: `profiles/github-id.md`

```md
# 표시할 이름

자기소개, 관심 분야, 기여 경험을 작성합니다.
```

## resources

상단 `리소스` 메뉴의 목록과 문서 페이지에 표시됩니다.

`resources/my-resource.md`

```md
---
authors: [github-id]
---

# 리소스 제목

목록에 표시할 짧은 설명을 작성합니다.

## 내용

본문을 작성합니다.
```

### navigation.yaml

`resources/navigation.yaml`에 리소스의 위치와 순서를 추가합니다.

```yaml
groups:
  - title: 코어 개발
    items:
      - ./contribution-flow.md # 문서의 # 제목 사용
      - file: ./building-nodejs-core.md
        title: Build Node.js # 목록 제목만 변경
```

## 확인

작성한 contributions, profiles, resources는 다음 명령으로 검사 가능합니다.

```sh
npm test
npm run validate
```

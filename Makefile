registry?=exposr
node_version=18.17.1
alpine_version=3.18
platforms?=linux/amd64,linux/arm64

project:=exposrd
version=$(shell [ -e build.env ] && . ./build.env 2> /dev/null && echo $${EXPOSR_BUILD_VERSION} || git describe --tags --always --dirty 2> /dev/null || git rev-parse --short HEAD)
commit=$(shell [ -e build.env ] && . ./build.env 2> /dev/null && echo $${BUILD_GIT_COMMIT} || git rev-parse --short HEAD)
package_name=$(project)-$(version).tgz

#
# Available make targets
#
# all - Defaults to building a release tarball and a container image for the host platform.
#
# package.build - Creates release tarball
# image.build - Build container image for host platform
# image.xbuild - Build container images for supported platforms

all: package.build.container image.build
clean: dist.clean
	docker buildx rm exposrd-builder || true
	rm -fr node_modules

get.version:
	@echo $(version)

define docker.run
	docker run --rm -i \
		-u $(shell id -u):$(shell id -g) \
		-v ${PWD}:/workdir \
		$(project)-builder \
		$1 $2 $3 $4 $5 $6 $7 $8 $9
endef

# Wraps any call and runs inside builder container
%.container: builder.build
	$(call docker.run, make $(subst .container,,$@))

package.build:
	yarn install --no-default-rc --frozen-lockfile
	mkdir -p dist
	yarn pack --no-default-rc --frozen-lockfile --filename dist/$(package_name)

dist/exposrd-$(version).tgz:
	make package.build.container

bundle.build:
	yarn install --no-default-rc --frozen-lockfile
	yarn run bundle

dist.clean:
	rm -fr dist

# Builder image
builder.build:
	docker build \
		--build-arg NODE_VERSION=${node_version} \
		--build-arg ALPINE_VERSION=${alpine_version} \
		-t $(project)-builder --target builder .

# Docker image build targets
image.build:
	docker build \
		-f Dockerfile \
		--progress plain \
		--build-arg NODE_VERSION=${node_version} \
		--build-arg ALPINE_VERSION=${alpine_version} \
		--build-arg VERSION=${version} \
		--build-arg DIST_SRC=dist/exposrd-$(version).tgz \
		--label "org.opencontainers.image.source=https://github.com/exposr/exposrd" \
		--label "org.opencontainers.image.version=$(version)" \
		--label "org.opencontainers.image.revision=$(commit)" \
		--label "org.opencontainers.image.description=exposrd version $(version) commit $(commit)" \
		-t $(project):$(version) \
		.

get.image:
	@echo $(project):$(version)

ifneq (, $(publish))
push_flag=--push
endif
image.xbuild:
	docker buildx create --name exposrd-builder --driver docker-container || true
	docker buildx build \
		--builder exposrd-builder \
		-f Dockerfile \
		--progress plain \
		--platform $(platforms) \
		$(push_flag) \
		--build-arg NODE_VERSION=${node_version} \
		--build-arg ALPINE_VERSION=${alpine_version} \
		--build-arg VERSION=${version} \
		--build-arg DIST_SRC=dist/exposrd-$(version).tgz \
		--label "org.opencontainers.image.source=https://github.com/exposr/exposrd" \
		--label "org.opencontainers.image.version=$(version)" \
		--label "org.opencontainers.image.revision=$(commit)" \
		--label "org.opencontainers.image.description=exposrd version $(version) commit $(commit)" \
		-t $(registry)/$(project):$(version) \
		.

image.xbuild.latest:
	docker buildx imagetools create --tag $(registry)/$(project):latest $(registry)/$(project):$(version)

image.xbuild.unstable:
	docker buildx imagetools create --tag $(registry)/$(project):unstable $(registry)/$(project):$(version)

.PHONY: release release.publish builder.build image.build image.xbuild image.xbuild.latest image.xbuild.unstable